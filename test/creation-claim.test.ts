// test/creation-claim.test.ts — The exclusive, cross-process creation claim
// (#133 CORR-3).
//
// The claim is a FILE, so it is driven here the way a second process would drive
// it: through the filesystem, with the data dir pointed at a temp dir
// (X_FACTORY_DATA_DIR) so no test touches the shared ~/.x-factory. Timing seams
// (ttlMs / waitTimeoutMs / pollIntervalMs) are injected rather than waited on, so
// every assertion below is deterministic rather than a sleep race.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getLocksDir, getProjectDir } from "../src/paths.js";
import {
  ClaimLostError,
  ClaimTimeoutError,
  type CreationClaim,
  type CreationClaimOptions,
  getCreationClaimPath,
  withCreationClaim,
} from "../src/services/creation-claim.js";

let tempDir: string;
let dataDir: string;

const originalDataDir = process.env.X_FACTORY_DATA_DIR;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-creation-claim-"));
  dataDir = path.join(tempDir, "data");
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = originalDataDir;
  await rm(tempDir, { recursive: true, force: true });
});

/** A one-shot gate, so a hold lasts exactly as long as the test says. */
function deferred(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

interface HeldClaim {
  /** The claimed action's promise; resolves when the test lets it go. */
  held: Promise<unknown>;
  /** Lets the held action finish (and thus release the claim). */
  release: () => void;
}

/**
 * Starts a claim and returns only once the action is actually INSIDE it, so
 * "the claim is held" is established, not assumed.
 */
async function holdClaim(
  projectId: string,
  options: CreationClaimOptions = {},
): Promise<HeldClaim> {
  const entered = deferred();
  const release = deferred();
  const held = withCreationClaim(
    projectId,
    async () => {
      entered.open();
      await release.opened;
      return "held";
    },
    options,
  );
  await entered.opened;
  return { held, release: release.open };
}

/** Backdates a claim file, as a crashed holder's would look to a peer. */
async function backdate(claimPath: string, ageMs: number): Promise<void> {
  const past = new Date(Date.now() - ageMs);
  await utimes(claimPath, past, past);
}

/** Writes a claim file as an already-dead holder would have left it. */
async function writeForeignClaim(
  claimPath: string,
  token: string,
  ageMs: number,
): Promise<void> {
  await mkdir(path.dirname(claimPath), { recursive: true });
  await writeFile(claimPath, `${token}\n`);
  await backdate(claimPath, ageMs);
}

describe("withCreationClaim", () => {
  it("admits exactly one holder per project id: a second claimant does not enter while the first holds it", async () => {
    const id = "exclusive";
    const claimPath = getCreationClaimPath(id);
    const first = await holdClaim(id);

    // Positive evidence that holding is a real, observable claim on disk.
    expect((await readFile(claimPath, "utf-8")).trim().length).toBeGreaterThan(
      0,
    );

    let secondEntered = false;
    await expect(
      withCreationClaim(
        id,
        async () => {
          secondEntered = true;
          return "second";
        },
        { waitTimeoutMs: 60, pollIntervalMs: 5 },
      ),
    ).rejects.toThrow(ClaimTimeoutError);
    // The second claimant never ran its action: it waited, then failed loudly.
    expect(secondEntered).toBe(false);
    // …and it did not disturb the holder's claim.
    expect((await readFile(claimPath, "utf-8")).trim().length).toBeGreaterThan(
      0,
    );

    first.release();
    await expect(first.held).resolves.toBe("held");

    // Released on success: nothing is left behind and the next claimant enters.
    await expect(stat(claimPath)).rejects.toThrow();
    await expect(withCreationClaim(id, async () => "third")).resolves.toBe(
      "third",
    );
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("releases the claim when the claimed action throws, so no failed action can wedge the id", async () => {
    const id = "throw";
    const claimPath = getCreationClaimPath(id);

    await expect(
      withCreationClaim(id, async () => {
        throw new Error("claimed action failed");
      }),
    ).rejects.toThrow("claimed action failed");

    await expect(stat(claimPath)).rejects.toThrow();
    await expect(withCreationClaim(id, async () => "after")).resolves.toBe(
      "after",
    );
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("reclaims a claim abandoned past the TTL, so a crashed holder cannot deadlock the id", async () => {
    const id = "abandoned";
    const claimPath = getCreationClaimPath(id);
    await writeForeignClaim(claimPath, "crashed-holder-token", 5 * 60_000);

    await expect(
      withCreationClaim(id, async () => "recovered", {
        ttlMs: 1_000,
        waitTimeoutMs: 1_000,
        pollIntervalMs: 5,
      }),
    ).resolves.toBe("recovered");

    // The abandoned claim was consumed, and the takeover left no tombstone.
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("never takes over a live claim, however long the contender waits", async () => {
    const id = "live";
    const claimPath = getCreationClaimPath(id);
    // Fresh mtime: the holder is (or claims to be) alive.
    await writeForeignClaim(claimPath, "live-holder-token", 0);

    await expect(
      withCreationClaim(id, async () => "never", {
        ttlMs: 60_000,
        waitTimeoutMs: 40,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(ClaimTimeoutError);

    // The live holder's claim file is still exactly what it was.
    expect((await readFile(claimPath, "utf-8")).trim()).toBe(
      "live-holder-token",
    );
  });

  it("releases only its OWN claim: a holder whose claim was reclaimed cannot delete its successor's", async () => {
    const id = "successor";
    const claimPath = getCreationClaimPath(id);

    // A holds the claim, then backdate it as a stale TTL takeover would see it
    // while A is still running.
    const a = await holdClaim(id);
    await backdate(claimPath, 5 * 60_000);

    // B takes the abandoned claim over and holds it in turn.
    const b = await holdClaim(id, {
      ttlMs: 1_000,
      waitTimeoutMs: 2_000,
      pollIntervalMs: 5,
    });
    expect((await readFile(claimPath, "utf-8")).trim().length).toBeGreaterThan(
      0,
    );

    // A now finishes and releases. Its token is no longer the claim's token, so
    // it must leave B's claim alone.
    a.release();
    await expect(a.held).resolves.toBe("held");
    await expect(stat(claimPath)).resolves.toBeDefined();

    // Proof that B still owns it: a third claimant cannot enter.
    await expect(
      withCreationClaim(id, async () => "never", {
        waitTimeoutMs: 60,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(ClaimTimeoutError);

    b.release();
    await expect(b.held).resolves.toBe("held");
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("keeps claims independent per project id, so unrelated ids never contend", async () => {
    const first = await holdClaim("independent-a");

    await expect(
      withCreationClaim("independent-b", async () => "b", {
        waitTimeoutMs: 20,
        pollIntervalMs: 5,
      }),
    ).resolves.toBe("b");

    first.release();
    await expect(first.held).resolves.toBe("held");
  });

  it("bounds the wait for a contended claim instead of queueing forever", async () => {
    const id = "bounded";
    const held = await holdClaim(id);

    const started = Date.now();
    let error: ClaimTimeoutError | undefined;
    try {
      await withCreationClaim(id, async () => "never", {
        waitTimeoutMs: 80,
        pollIntervalMs: 5,
      });
    } catch (err) {
      error = err as ClaimTimeoutError;
    }
    const elapsed = Date.now() - started;

    expect(error).toBeInstanceOf(ClaimTimeoutError);
    // The bound is the one it reports, and it gave up on its own — far short of
    // the holder's (still unexpired) hold.
    expect(error?.waitedMs).toBe(80);
    expect(error?.claimPath).toBe(getCreationClaimPath(id));
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(5_000);

    held.release();
    await expect(held.held).resolves.toBe("held");
  });

  it("renews the claim via heartbeat so a genuinely live holder is never reclaimed past the TTL", async () => {
    const id = "heartbeat-live";

    // Holder runs with a short TTL (60ms). Heartbeat fires every ~20ms.
    const holderEntered = deferred();
    const releaseHolder = deferred();
    const holder = withCreationClaim(
      id,
      async (claim) => {
        holderEntered.open();
        // Wait 120ms (double the TTL) while alive:
        await delay(120);
        await claim.assertHeld();
        await releaseHolder.opened;
        return "alive";
      },
      { ttlMs: 60, heartbeat: true },
    );

    await holderEntered.opened;

    // A contender tries to acquire while the holder is in its long action.
    // Because heartbeat touched the claim mtime, the contender does not reclaim it.
    await expect(
      withCreationClaim(id, async () => "contender", {
        ttlMs: 60,
        waitTimeoutMs: 50,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(ClaimTimeoutError);

    releaseHolder.open();
    await expect(holder).resolves.toBe("alive");
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("fences a holder via assertHeld() if its claim was lost or stolen", async () => {
    const id = "fenced-holder";
    const claimPath = getCreationClaimPath(id);

    const holderEntered = deferred();
    const releaseHolder = deferred();
    let holderClaim: CreationClaim | undefined;

    const holder = withCreationClaim(
      id,
      async (claim) => {
        holderClaim = claim;
        holderEntered.open();
        await releaseHolder.opened;
        await claim.assertHeld();
        return "completed";
      },
      { heartbeat: false },
    );

    await holderEntered.opened;
    expect(holderClaim).toBeDefined();
    await expect(holderClaim?.assertHeld()).resolves.toBeUndefined();

    // Foreign process steals or replaces the claim file
    await writeFile(claimPath, "foreign-token\n");

    // The original holder's assertHeld() now detects claim loss and throws ClaimLostError
    await expect(holderClaim?.assertHeld()).rejects.toThrow(ClaimLostError);

    releaseHolder.open();
    await expect(holder).rejects.toThrow(ClaimLostError);
  });
});

describe("claim placement", () => {
  it("derives the claim path from a sanitised id, outside the project's own directory", () => {
    const id = "acme/rocket";
    const claimPath = getCreationClaimPath(id);
    const locksPrefix = `${getLocksDir()}${path.sep}`;

    // Claims live under <dataDir>/locks — never inside the project's tree, so a
    // rejected creation leaves no project artifact and no orphan secret.
    expect(getLocksDir()).toBe(path.join(dataDir, "locks"));
    expect(claimPath.startsWith(locksPrefix)).toBe(true);
    expect(claimPath.startsWith(getProjectDir(id))).toBe(false);

    // No id character reaches the filename unescaped: a traversing id stays put.
    const traversing = getCreationClaimPath("../../etc/passwd");
    expect(traversing.startsWith(locksPrefix)).toBe(true);
    expect(
      path
        .resolve(traversing)
        .startsWith(`${path.resolve(getLocksDir())}${path.sep}`),
    ).toBe(true);
    expect(path.basename(traversing)).not.toContain(path.sep);
    expect(traversing).not.toContain("..");

    // Ids that sanitise to the same readable text are still distinct claims, so
    // one project's claim never blocks another's.
    expect(getCreationClaimPath("acme/rocket")).not.toBe(
      getCreationClaimPath("acme_rocket"),
    );
  });
});
