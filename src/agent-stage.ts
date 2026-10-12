// src/agent-stage.ts — One prompt in one fresh read-only session (#282).
//
// Understand and Plan are real model calls by the Builder with read-only
// repository tools (read, grep, find, ls). This module owns what those stages
// share: opening the session, streaming its text to the run page, pacing the
// call through the gateway so a 429 waits instead of failing (#280), reporting
// the tokens and cost it used, and disposing it.
//
// Nothing here invents an answer. What the session says is what the stage gets;
// a model that can't be reached, rejects its key, is rate limited past the
// ceiling or is aborted raises a typed error the stage reports as its reason.

import {
  assertFitsContextWindow,
  classifyModelError,
  createReadOnlySession,
  disposeQuietly,
  type PiAgentSession,
  type PiUsage,
  type ReadOnlySessionFactory,
} from "./agents/pi.js";
import { DomainError } from "./errors.js";
import type { EmitEvent, StageOutcome } from "./executors/types.js";
import { modelErrorSentence, modelStageFailure } from "./model-failures.js";
import {
  gatewayKeyFor,
  type ModelGateway,
  modelGateway,
} from "./model-gateway.js";
import {
  isBudgetReached,
  ModelUnavailableError,
  type ResolvedModel,
} from "./model-roles.js";

/**
 * The model answered, but not in the shape the stage can use: an honest stage
 * failure, never a substitute answer.
 */
export class ModelOutputError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

/** Everything a read-only model stage needs; the stage adds its own inputs. */
export interface ReadOnlyStageRun {
  /** The role's model (#278): required, there is no fallback model. */
  resolved: ResolvedModel;
  worktreePath: string;
  /** Test seam: replaces the Pi session this module opens. */
  sessionFactory?: ReadOnlySessionFactory | undefined;
  /** Shows the session's tool use and errors on the run page. */
  emit?: EmitEvent | undefined;
  /** Told about each rate-limit wait before it happens. */
  onWait?: ((ms: number, reason: string) => void) | undefined;
  /** Receives the tokens and cost the session reported. */
  onUsage?: ((usage: PiUsage) => void) | undefined;
  signal?: AbortSignal | undefined;
  /** The pacing gateway; the worker's by default (#280). */
  gateway?: ModelGateway | undefined;
  /** Throws when the model's daily budget is spent, before each call (#281). */
  checkBudget?: (() => void) | undefined;
  /** Counts one model call towards the model's daily budget (#281). */
  recordCall?: (() => void) | undefined;
}

export function abortError(): Error {
  return new Error("Stage aborted");
}

/**
 * Collects the session's text and shows its tool use on the run page. Text is
 * not emitted fragment by fragment: a streamed answer would become hundreds of
 * event rows and chat lines; the stage records the finished answer instead.
 */
function attachStageListeners(
  session: PiAgentSession,
  emit: EmitEvent | undefined,
): () => string {
  let output = "";
  session.subscribe((event) => {
    if (event.type === "text" && event.text) {
      output += event.text;
    } else if (event.type === "tool") {
      emit?.("info", { text: `Running tool ${event.tool}` });
    }
    // A session error is not emitted as it happens: its text is the provider's raw
    // body, and a rate-limited call reports one per retry. The call's failure is
    // told once, as a sentence, when the stage gives up (see runReadOnlyStage).
  });
  return () => output;
}

async function openSession(run: ReadOnlyStageRun): Promise<PiAgentSession> {
  try {
    return run.sessionFactory
      ? await run.sessionFactory(run.worktreePath, { resolved: run.resolved })
      : await createReadOnlySession(run.worktreePath, {
          resolved: run.resolved,
        });
  } catch (err: unknown) {
    if (run.signal?.aborted) throw abortError();
    if (err instanceof ModelUnavailableError) throw err;
    throw new ModelUnavailableError(
      `Could not start a session for ${run.resolved.modelId} on "${run.resolved.connectionName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Runs `prompt` in a fresh read-only session and returns everything it said.
 * Throws `ModelUnavailableError` when the model can't be used, the classified
 * error otherwise, and aborts with the signal.
 */
export async function runReadOnlyStage(
  run: ReadOnlyStageRun,
  prompt: string,
): Promise<string> {
  if (run.signal?.aborted) throw abortError();
  // Refused before a session opens: a prompt that cannot fit is never sent (#280).
  assertFitsContextWindow(run.resolved, prompt);
  const session = await openSession(run);
  const readOutput = attachStageListeners(session, run.emit);

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    session.abort().catch(() => {});
  };
  run.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // A real Pi session ignores an abort that arrives before a prompt.
    if (run.signal?.aborted) onAbort();
    if (aborted) throw abortError();
    const gateway = run.gateway ?? modelGateway;
    await gateway.run(
      gatewayKeyFor(run.resolved, {
        checkBudget: run.checkBudget,
        recordCall: run.recordCall,
      }),
      async () => {
        try {
          await session.prompt(prompt);
        } catch (err: unknown) {
          throw classifyModelError(
            err instanceof Error ? err.message : String(err),
          );
        }
      },
      { onWait: run.onWait, signal: run.signal },
    );
  } catch (err: unknown) {
    if (aborted) throw abortError();
    const failure =
      err instanceof ModelUnavailableError
        ? err
        : classifyModelError(err instanceof Error ? err.message : String(err));
    // One short sentence for the timeline; the raw text stays on the error, which the
    // stage records on its attempt. A spent budget pauses the run and says so itself.
    if (!isBudgetReached(failure)) {
      run.emit?.("error", {
        message: modelErrorSentence(failure, run.resolved),
      });
    }
    throw failure;
  } finally {
    run.signal?.removeEventListener("abort", onAbort);
    const usage = session.usage?.();
    if (usage && run.onUsage) run.onUsage(usage);
    disposeQuietly(session);
  }

  if (aborted) throw abortError();
  return readOutput();
}

/**
 * The outcome of a stage that failed for its model, or null when the error is not a
 * model failure and the stage runner should handle it (#282). `resolved` is the role's
 * model when it resolved, so the failure can name it.
 */
export function modelStageOutcome(
  err: unknown,
  resolved: ResolvedModel | undefined,
): Extract<StageOutcome, { outcome: "error" }> | null {
  // A spent budget is not a failure: the stage runner pauses the run (#281).
  if (isBudgetReached(err)) return null;
  if (err instanceof ModelUnavailableError) {
    return modelStageFailure(err, resolved);
  }
  if (err instanceof ModelOutputError) {
    return { outcome: "error", error: err.message };
  }
  return null;
}
