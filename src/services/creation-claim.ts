// src/services/creation-claim.ts — The exclusive, cross-process claim that
// makes project creation atomic per project id (#133 CORR-3).
//
// WHY A CLAIM IS NEEDED
// Project creation is an ordered read-modify-write over two shared files: the
// per-project secret store (src/project-env.ts) and the projects config file
// (src/config.ts). A duplicate pre-check is NOT sufficient to make that safe:
// two creations of the same id can both pass the check, both write secrets, and
// only then have one of them lose the record append — leaving the WINNER's
// secret overwritten by the LOSER's values, and a loser that wrote secrets for
// a project it never created. The claim moves the duplicate check AND both
// writes inside one mutually exclusive region, so the loser cannot write at all.
//
// WHY THE PRIMITIVE IS PROCESS-SAFE
// The claim is an exclusive file CREATE (`open(path, "wx")` → open(2) with
// O_CREAT|O_EXCL). The kernel performs "create this path if it does not exist"
// atomically: exactly one caller can win, every other caller gets EEXIST. That
// exclusivity is enforced by the filesystem rather than by this process, so it
// holds between two OS processes (two servers, or a server and a CLI) exactly
// as it holds between two async tasks in one event loop. An in-process mutex
// would serialise only the latter, which is why it is not used — even as a
// fast-path optimisation, since that would add a second, weaker ownership rule.
//
// ORDER INSIDE THE CLAIM (owned by the caller, src/services/project-creation.ts)
// acquire claim → duplicate check → secrets (idempotent) → project record
// (the commit point) → release claim. A crash after the secrets leaves a benign
// orphaned env file, never a project without secrets — unchanged by the claim,
// which adds no write of its own to the project tree.

import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ConflictError } from "../errors.js";
import { getLocksDir } from "../paths.js";

/**
 * A claim older than this is presumed ABANDONED: its holder crashed (or was
 * killed) between acquiring and releasing it, and no live holder is still in
 * that region. Reclaiming after a TTL, rather than never, is what keeps a
 * crashed creation from blocking that project id forever.
 *
 * Live holders actively touch the claim file's mtime (heartbeat renewal) while
 * their action runs, so a genuinely live holder is never reclaimed.
 *
 * The TTL is a wall-clock duration read from the claim file's mtime — the same
 * clock a concurrent process sees — measured from acquisition, before the first
 * write, so the window covers the whole critical section by construction. 30s is
 * orders of magnitude above the real critical section (three small file writes):
 * a claim that old with no heartbeat is not "slow", it is gone.
 */
export const CLAIM_TTL_MS = 30_000;

/**
 * Upper bound on how long a contender waits for a CONTENDED claim. Past this it
 * gives up with `ClaimTimeoutError` instead of queueing indefinitely: a request
 * must fail loudly rather than hang.
 *
 * It is deliberately longer than the TTL, so a claim left by a crashed holder is
 * always reclaimed within one wait rather than timing out on it — a caller only
 * ever times out on a holder that is genuinely alive but wedged.
 */
export const CLAIM_WAIT_TIMEOUT_MS = 60_000;

/** How often a waiting contender re-checks a contended claim. */
export const CLAIM_POLL_INTERVAL_MS = 25;

/**
 * Thrown when a contended claim could not be acquired within the wait bound. The
 * caller decides the domain meaning (for project creation: another creation of
 * that id is in flight, i.e. a conflict) — this module carries no domain
 * vocabulary of its own.
 */
export class ClaimTimeoutError extends Error {
  readonly claimPath: string;
  readonly waitedMs: number;

  constructor(claimPath: string, waitedMs: number) {
    super(
      `Timed out after ${waitedMs}ms waiting for the exclusive claim at ${claimPath}.`,
    );
    this.name = "ClaimTimeoutError";
    this.claimPath = claimPath;
    this.waitedMs = waitedMs;
  }
}

/**
 * Thrown when a held claim was stolen, superseded, or expired during execution.
 * Fencing checks before mutating side effects (e.g. secret persistence, commit)
 * call `claim.assertHeld()` to guarantee a slow or zombie holder cannot clobber
 * a successor's state.
 */
export class ClaimLostError extends Error {
  readonly claimPath: string;

  constructor(claimPath: string) {
    super(`Exclusive creation claim at ${claimPath} was lost or superseded.`);
    this.name = "ClaimLostError";
    this.claimPath = claimPath;
  }
}

/**
 * Translates creation claim errors into the canonical API ConflictError (HTTP 409).
 * Re-throws any unrelated error unchanged.
 */
export function translateClaimError(err: unknown, projectId: string): never {
  if (err instanceof ClaimTimeoutError) {
    throw new ConflictError(
      `Project with ID "${projectId}" is already being created.`,
    );
  }
  if (err instanceof ClaimLostError) {
    throw new ConflictError(
      `Project with ID "${projectId}" creation claim was lost to a concurrent operation.`,
    );
  }
  throw err;
}

/** Tuning seams; every field has a documented default. */
export interface CreationClaimOptions {
  /** See {@link CLAIM_TTL_MS}. */
  ttlMs?: number;
  /** See {@link CLAIM_WAIT_TIMEOUT_MS}. */
  waitTimeoutMs?: number;
  /** See {@link CLAIM_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
  /**
   * Whether to periodically touch the claim file mtime while the action is running
   * so a genuinely live slow holder is not reclaimed. Defaults to true.
   */
  heartbeat?: boolean;
}

/** The active claim instance passed to the claimed action. */
export interface CreationClaim {
  readonly projectId: string;
  readonly token: string;
  readonly claimPath: string;
  /**
   * Asserts that the claim file still exists and still belongs to this holder's token.
   * Throws {@link ClaimLostError} if the claim was lost, stolen, or superseded.
   */
  assertHeld(): Promise<void>;
}

/**
 * Claim file for one project id. The name is DERIVED from the id, never the id
 * itself: the digest keeps ids that sanitise to the same readable text
 * (`acme/api` vs `acme_api`) contending with themselves only, and no id
 * character reaches the path unescaped — no id can escape the locks directory,
 * however it is spelled.
 */
export function getCreationClaimPath(projectId: string): string {
  const readable = projectId
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // Runs of dots are collapsed so no id can leave a `..` component in a name
    // that is meant to be a single, flat path segment.
    .replace(/\.{2,}/g, "_")
    .slice(0, 48);
  const digest = createHash("sha256")
    .update(projectId)
    .digest("hex")
    .slice(0, 16);
  return path.join(getLocksDir(), `create-${readable}-${digest}.claim`);
}

interface ClaimRecord {
  /** Random token written by the holder that created this claim file. */
  token: string;
  /** Creation time of the claim file — the TTL clock. */
  mtimeMs: number;
}

/** Reads the claim file, or `null` when it does not exist (or vanished). */
async function readClaim(claimPath: string): Promise<ClaimRecord | null> {
  try {
    const [body, info] = await Promise.all([
      readFile(claimPath, "utf-8"),
      stat(claimPath),
    ]);
    return { token: body.trim(), mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}

/** The atomic acquire: O_CREAT|O_EXCL, so at most one caller can win. */
async function createClaimFile(
  claimPath: string,
  token: string,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(claimPath, "wx", 0o600);
  } catch (err) {
    if (isErrnoCode(err, "EEXIST")) return false;
    throw err;
  }
  try {
    // A failed write leaves an empty claim file, which the TTL reclaim cleans
    // up — so no code path has to guess whether an empty file is "ours".
    await handle.writeFile(`${token}\n`);
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Best-effort takeover of a claim whose holder is gone: after this returns, the
 * path is either free (retry the exclusive create) or still held by a live
 * claim, and there is nothing else the caller can usefully do either way.
 *
 * The takeover is itself race-safe. The claim is RENAMED to a private path
 * rather than unlinked, and the moved file is then verified to still carry the
 * exact token observed as abandoned — a compare-and-swap on the claim
 * generation. A contender that instead moved a claim which a peer had just
 * replaced puts it back with `link(2)`, which fails rather than clobbers an
 * existing path, and treats the claim as live. So the loser of a reclaim race
 * can never end up holding a claim that the winner also holds.
 */
async function reclaimIfAbandoned(
  claimPath: string,
  ttlMs: number,
  token: string,
): Promise<void> {
  const observed = await readClaim(claimPath);
  if (!observed) return;
  if (Date.now() - observed.mtimeMs < ttlMs) return;

  const tombstone = `${claimPath}.stale-${token}`;
  try {
    // `rename` preserves mtime, so the moved file still carries the evidence.
    await rename(claimPath, tombstone);
  } catch {
    // Released by its holder, or reclaimed by a peer, between the read and the
    // rename: the path is free now.
    return;
  }

  const moved = await readClaim(tombstone);
  if (moved?.token === observed.token) {
    await rm(tombstone, { force: true });
    return;
  }

  // We moved a claim that had been replaced in the window above: give it back
  // rather than take over a live holder's region.
  try {
    await link(tombstone, claimPath);
  } catch {
    // A peer claimed the path first; its claim stands.
  }
  await rm(tombstone, { force: true });
}

/**
 * Acquires the claim, or throws once the bounded wait is exhausted.
 *
 * Every non-winning iteration sleeps one poll interval before retrying, and the
 * bound is re-checked every iteration, so the wait is bounded by construction —
 * including against a claim file that can neither be read nor replaced.
 */
async function acquire(
  claimPath: string,
  token: string,
  options: CreationClaimOptions,
): Promise<void> {
  const ttlMs = options.ttlMs ?? CLAIM_TTL_MS;
  const pollIntervalMs = options.pollIntervalMs ?? CLAIM_POLL_INTERVAL_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? CLAIM_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeoutMs;

  await mkdir(path.dirname(claimPath), { recursive: true });

  for (;;) {
    if (await createClaimFile(claimPath, token)) return;

    // Contended: give up loudly once the bound is passed, rather than waiting
    // on a claim that may never be released.
    if (Date.now() >= deadline) {
      throw new ClaimTimeoutError(claimPath, waitTimeoutMs);
    }

    // …then reclaim it if its holder is gone, and re-check after a poll.
    await reclaimIfAbandoned(claimPath, ttlMs, token);
    await delay(pollIntervalMs);
  }
}

/**
 * Releases the claim, but only while it is still OURS: a holder whose claim was
 * reclaimed after the TTL must never delete the claim file its successor now
 * owns.
 */
async function release(claimPath: string, token: string): Promise<void> {
  const current = await readClaim(claimPath);
  if (current?.token !== token) return;
  await rm(claimPath, { force: true });
}

/**
 * Runs `action` while holding the exclusive claim for `projectId`, releasing it
 * on success and on failure alike (a rejected creation must leave no claim).
 *
 * An active heartbeat timer touches the claim file's mtime so a live holder is
 * never reclaimed by TTL. The action is passed a `claim` instance with
 * `assertHeld()`, allowing mutating steps (e.g. secret persistence, commit) to
 * be fenced against unexpected claim loss.
 *
 * The claim is per project id: two actions for the same id are mutually
 * exclusive, while actions for different ids never wait on each other.
 * Contenders are NOT queued by arrival order — there is no fair queue, by
 * design: the point of the claim is to make the losers rejectable inside it,
 * not to order them.
 */
export async function withCreationClaim<T>(
  projectId: string,
  action: (claim: CreationClaim) => Promise<T>,
  options: CreationClaimOptions = {},
): Promise<T> {
  const claimPath = getCreationClaimPath(projectId);
  const token = randomUUID();

  await acquire(claimPath, token, options);

  const claim: CreationClaim = {
    projectId,
    token,
    claimPath,
    async assertHeld(): Promise<void> {
      const current = await readClaim(claimPath);
      if (current?.token !== token) {
        throw new ClaimLostError(claimPath);
      }
    },
  };

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  if (options.heartbeat !== false) {
    const ttlMs = options.ttlMs ?? CLAIM_TTL_MS;
    const heartbeatMs = Math.max(10, Math.floor(ttlMs / 3));
    heartbeatTimer = setInterval(async () => {
      try {
        const current = await readClaim(claimPath);
        if (current?.token === token) {
          const now = new Date();
          await utimes(claimPath, now, now);
        }
      } catch {
        // Renewal is best-effort; assertHeld() remains authoritative
      }
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  try {
    return await action(claim);
  } finally {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
    }
    await release(claimPath, token);
  }
}
