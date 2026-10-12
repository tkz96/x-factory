// src/model-gateway.ts — The one gate every model call passes through (#280).
//
// - Rate limits: a 429 makes the call wait as long as the provider asked
//   (Retry-After, or Gemini's "retry in 49.58s"), else back off exponentially
//   with jitter, capped. Waiting is reported, not failed. Past a ceiling the
//   call fails with "rate limited". A provider that asks for a wait longer than
//   the ceiling (a daily quota: "retry in 23h") fails the call at once with
//   "quota exhausted" and when it resets.
// - Concurrency: at most `limit` calls per model run at once, across runs, in
//   arrival order; other models are never held up.

import { ModelUnavailableError, type ResolvedModel } from "./model-roles.js";
import { formatApproxWait } from "./retry-delay.js";
import { modelKey } from "./shared/model-key.js";

export interface ModelGatewayClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const realClock: ModelGatewayClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    }),
};

/** A provider said "too many requests"; `retryAfterMs` is its requested wait, when given. */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number | undefined;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

const RATE_LIMIT =
  /\b429\b|rate[ _-]?limit|too many requests|resource[ _-]?exhausted|exceeded your current quota/i;

export function isRateLimitMessage(message: string): boolean {
  return RATE_LIMIT.test(message);
}

/** The wait a provider asked for: one reader, shared with model discovery. */
export { parseRetryDelayMs } from "./retry-delay.js";

/** Calls in flight per model: from requests per minute (one per 10 rpm, 1–8), else 2. */
export function concurrencyLimitFor(limits: {
  rpm?: number | undefined;
}): number {
  if (!limits.rpm) return 2;
  return Math.min(8, Math.max(1, Math.floor(limits.rpm / 10)));
}

export interface GatewayOptions {
  clock?: ModelGatewayClock;
  /** Longest total wait before giving up, ms. */
  maxWaitMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** 0–1; jitter multiplies a backoff by 0.5–1.5. */
  random?: () => number;
}

export interface GatewayKey {
  /** One queue per model: connection ID and model ID. */
  key: string;
  /** The model as a person names it, for the reasons the gateway gives. */
  label?: string | undefined;
  limit: number;
  /** Optional budget check hook called before acquiring a concurrency slot (#281). */
  checkBudget?: (() => void | Promise<void>) | undefined;
  /**
   * Called once per attempt, a retry after a 429 included: every attempt is one
   * model call, and the requests/day budget counts calls (#281).
   */
  recordCall?: (() => void) | undefined;
}

export interface RunHooks {
  /** Called before each wait, with its length and why. */
  onWait?: ((ms: number, reason: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

interface Lane {
  active: number;
  waiting: Array<() => void>;
}

export class ModelGateway {
  private readonly clock: ModelGatewayClock;
  private readonly maxWaitMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly random: () => number;
  private readonly lanes = new Map<string, Lane>();

  constructor(options: GatewayOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.maxWaitMs = options.maxWaitMs ?? 10 * 60_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.random = options.random ?? Math.random;
  }

  async acquire(
    { key, limit }: GatewayKey,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Operation aborted");
    }
    const lane = this.lanes.get(key) ?? { active: 0, waiting: [] };
    this.lanes.set(key, lane);
    if (lane.active >= Math.max(1, limit)) {
      await new Promise<void>((resolve, reject) => {
        let onAbort: (() => void) | undefined;
        const waiter = () => {
          if (signal && onAbort) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve();
        };
        if (signal) {
          onAbort = () => {
            const idx = lane.waiting.indexOf(waiter);
            if (idx !== -1) {
              lane.waiting.splice(idx, 1);
            }
            reject(signal.reason ?? new Error("Operation aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
        lane.waiting.push(waiter);
      });
    } else {
      lane.active++;
    }
    return () => {
      const next = lane.waiting.shift();
      // The slot passes straight to the next caller in line.
      if (next) next();
      else lane.active--;
    };
  }

  private backoffMs(retry: number): number {
    const exponential = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** retry,
    );
    return Math.round(exponential * (0.5 + this.random()));
  }

  /** The wait before the next try, or undefined when the ceiling is reached. */
  nextWaitMs(
    err: RateLimitedError,
    retry: number,
    waitedMs: number,
  ): number | undefined {
    const wait = err.retryAfterMs ?? this.backoffMs(retry);
    return waitedMs + wait > this.maxWaitMs ? undefined : wait;
  }

  async run<T>(
    key: GatewayKey,
    fn: () => Promise<T>,
    hooks: RunHooks = {},
  ): Promise<T> {
    // A spent budget is refused before a concurrency slot is taken, so it never
    // holds up another run's call.
    await key.checkBudget?.();
    const release = await this.acquire(key, hooks.signal);
    try {
      let waited = 0;
      for (let retry = 0; ; retry++) {
        // Every retry is another request: it is checked against the budget and
        // counted again (#281).
        if (retry > 0) await key.checkBudget?.();
        key.recordCall?.();
        try {
          return await fn();
        } catch (err: unknown) {
          if (!(err instanceof RateLimitedError)) throw err;
          // A wait longer than the gateway would ever wait is a used-up quota (a
          // daily limit says "retry in 23h"), not a short rate limit: fail now
          // instead of backing off until the ceiling.
          if (
            err.retryAfterMs !== undefined &&
            err.retryAfterMs > this.maxWaitMs
          ) {
            throw new ModelUnavailableError(
              `The provider's quota for ${key.label ?? "the model"} is used up. It resets in ${formatApproxWait(err.retryAfterMs)}.`,
              "quota exhausted",
              { raw: err.message, retryAfterMs: err.retryAfterMs },
            );
          }
          const wait = this.nextWaitMs(err, retry, waited);
          if (wait === undefined) {
            throw new ModelUnavailableError(
              `Rate limited: the provider kept refusing requests for over ${Math.round(this.maxWaitMs / 60_000)} min.`,
              "rate limited",
              { raw: err.message },
            );
          }
          hooks.onWait?.(wait, err.message);
          await this.clock.sleep(wait, hooks.signal);
          waited += wait;
        }
      }
    } finally {
      release();
    }
  }
}

/** The budget-check and call-counting hooks a caller hands the gateway (#281). */
export interface GatewayCallHooks {
  checkBudget?: (() => void | Promise<void>) | undefined;
  recordCall?: (() => void) | undefined;
}

/** The gateway queue a role's model uses: one per connection and model. */
export function gatewayKeyFor(
  resolved: ResolvedModel,
  hooks: GatewayCallHooks = {},
): GatewayKey {
  return {
    key: modelKey(resolved.connectionId, resolved.modelId),
    label: resolved.modelId,
    limit: concurrencyLimitFor(resolved.limits),
    checkBudget: hooks.checkBudget,
    recordCall: hooks.recordCall,
  };
}

/** The worker's one gateway, shared by every run it executes. */
export const modelGateway = new ModelGateway();
