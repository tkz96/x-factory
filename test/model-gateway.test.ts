// test/model-gateway.test.ts — Every model call goes through one gateway that
// waits as long as a 429 asks, backs off when it doesn't say, gives up past a
// ceiling, and queues calls per model across runs (#280). A fake clock keeps
// the tests deterministic.

import { describe, expect, it } from "bun:test";
import {
  concurrencyLimitFor,
  isRateLimitMessage,
  ModelGateway,
  parseRetryDelayMs,
  RateLimitedError,
} from "../src/model-gateway.js";
import { ModelUnavailableError } from "../src/model-roles.js";

/** A clock whose sleeps complete instantly but advance `now`. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

describe("parseRetryDelayMs", () => {
  it.each([
    ["You exceeded your current quota. Please retry in 49.58s.", 50_000],
    ['{"retryDelay": "30s"}', 30_000],
    ["Retry-After: 12", 12_000],
    ["rate limited, retry after 7 seconds", 7_000],
    ["429 Too Many Requests", undefined],
  ])("%s → %s", (text, expected) => {
    expect(parseRetryDelayMs(text)).toBe(expected);
  });
});

describe("isRateLimitMessage", () => {
  it("recognises 429s and quota exhaustion, not other errors", () => {
    expect(isRateLimitMessage("429 Too Many Requests")).toBe(true);
    expect(isRateLimitMessage("RESOURCE_EXHAUSTED: quota")).toBe(true);
    expect(isRateLimitMessage("You exceeded your current quota")).toBe(true);
    expect(isRateLimitMessage("rate limit reached")).toBe(true);
    expect(isRateLimitMessage("401 Unauthorized")).toBe(false);
    expect(isRateLimitMessage("ECONNREFUSED")).toBe(false);
  });
});

describe("concurrencyLimitFor", () => {
  it("derives from requests per minute, defaulting to 2", () => {
    expect(concurrencyLimitFor({})).toBe(2);
    expect(concurrencyLimitFor({ rpm: 5 })).toBe(1);
    expect(concurrencyLimitFor({ rpm: 60 })).toBe(6);
    expect(concurrencyLimitFor({ rpm: 10_000 })).toBe(8);
  });
});

describe("ModelGateway.run", () => {
  it("waits exactly as long as the provider asked, then succeeds", async () => {
    const { clock, sleeps } = fakeClock();
    const gateway = new ModelGateway({ clock });
    const waits: number[] = [];
    let calls = 0;
    const result = await gateway.run(
      { key: "c1:m", limit: 2 },
      async () => {
        calls++;
        if (calls === 1) throw new RateLimitedError("429", 49_580);
        return "ok";
      },
      { onWait: (ms) => waits.push(ms) },
    );
    expect(result).toBe("ok");
    expect(sleeps).toEqual([49_580]);
    expect(waits).toEqual([49_580]);
  });

  it("backs off exponentially with jitter, capped, when no delay is given", async () => {
    const { clock, sleeps } = fakeClock();
    const gateway = new ModelGateway({
      clock,
      random: () => 0.5,
      baseBackoffMs: 1_000,
      maxBackoffMs: 5_000,
      maxWaitMs: 60_000,
    });
    let calls = 0;
    await gateway.run({ key: "c1:m", limit: 1 }, async () => {
      calls++;
      if (calls <= 4) throw new RateLimitedError("429");
      return "ok";
    });
    // 1s, 2s, 4s, then capped at 5s; jitter 0.5 → ×1 (range 0.5–1.5).
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 5_000]);
  });

  it("gives up past the wait ceiling with 'rate limited'", async () => {
    const { clock } = fakeClock();
    const gateway = new ModelGateway({ clock, maxWaitMs: 60_000 });
    const err = await gateway
      .run({ key: "c1:m", limit: 1 }, async () => {
        throw new RateLimitedError("429", 90_000);
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("rate limited");
  });

  it("passes other errors straight through, without retrying", async () => {
    const { clock, sleeps } = fakeClock();
    const gateway = new ModelGateway({ clock });
    let calls = 0;
    const err = await gateway
      .run({ key: "c1:m", limit: 1 }, async () => {
        calls++;
        throw new Error("boom");
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("boom");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("runs at most `limit` calls per model at once, in arrival order; other models are not held up", async () => {
    const gateway = new ModelGateway({ clock: fakeClock().clock });
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const call = (key: string, name: string) =>
      gateway.run({ key, limit: 1 }, () => {
        started.push(name);
        return new Promise<string>((resolve) =>
          releases.set(name, () => resolve(name)),
        );
      });

    const a = call("c1:m", "run-a");
    const b = call("c1:m", "run-b");
    const c = call("c1:m", "run-c");
    const other = call("c2:x", "run-other");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["run-a", "run-other"]);

    releases.get("run-a")?.();
    await a;
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["run-a", "run-other", "run-b"]);

    releases.get("run-b")?.();
    await b;
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["run-a", "run-other", "run-b", "run-c"]);
    releases.get("run-c")?.();
    releases.get("run-other")?.();
    await Promise.all([c, other]);
  });

  it("frees the slot when a call fails, so the next one runs", async () => {
    const gateway = new ModelGateway({ clock: fakeClock().clock });
    await gateway
      .run({ key: "c1:m", limit: 1 }, async () => {
        throw new Error("boom");
      })
      .catch(() => {});
    expect(
      await gateway.run({ key: "c1:m", limit: 1 }, async () => "next"),
    ).toBe("next");
  });

  it("calls checkBudget before acquire, propagating errors without taking a slot", async () => {
    const gateway = new ModelGateway({ clock: fakeClock().clock });
    let executed = false;
    const checkBudget = () => {
      throw new ModelUnavailableError("Daily budget reached", "budget reached");
    };

    await expect(
      gateway.run({ key: "c1:m", limit: 1, checkBudget }, async () => {
        executed = true;
        return "ok";
      }),
    ).rejects.toThrow("Daily budget reached");

    expect(executed).toBe(false);

    // Slot is still free for another call
    expect(
      await gateway.run({ key: "c1:m", limit: 1 }, async () => "unblocked"),
    ).toBe("unblocked");
  });

  it("counts each attempt, a retry after a 429 included, before it is made (#281)", async () => {
    const { clock } = fakeClock();
    const gateway = new ModelGateway({ clock });
    const counted: number[] = [];
    const attempts: number[] = [];
    const result = await gateway.run(
      {
        key: "c1:m",
        limit: 1,
        recordCall: () => counted.push(attempts.length + 1),
      },
      async () => {
        attempts.push(attempts.length + 1);
        if (attempts.length === 1) throw new RateLimitedError("429", 1_000);
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toEqual([1, 2]);
    // Each request was counted as it was sent, the retry included.
    expect(counted).toEqual([1, 2]);
  });

  it("re-checks the budget before a retry, since the retry is another request (#281)", async () => {
    const { clock } = fakeClock();
    const gateway = new ModelGateway({ clock });
    const counted: number[] = [];
    const checkBudget = () => {
      if (counted.length >= 1) {
        throw new ModelUnavailableError(
          "Model reached its daily budget: 1/1 model calls today (UTC).",
          "budget reached",
        );
      }
    };
    const err = await gateway
      .run(
        {
          key: "c1:m",
          limit: 1,
          checkBudget,
          recordCall: () => counted.push(counted.length + 1),
        },
        async () => {
          throw new RateLimitedError("429", 1_000);
        },
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("budget reached");
    expect(counted).toEqual([1]);
  });

  it("rejects immediately when acquire signal is already aborted", async () => {
    const gateway = new ModelGateway({ clock: fakeClock().clock });
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));

    await expect(
      gateway.acquire({ key: "c1:m", limit: 1 }, controller.signal),
    ).rejects.toThrow("pre-aborted");

    // The slot was not consumed
    const release = await gateway.acquire({ key: "c1:m", limit: 1 });
    release();
  });

  it("removes a FIFO waiter from queue and rejects when signal aborts while waiting", async () => {
    const gateway = new ModelGateway({ clock: fakeClock().clock });
    // Occupy the only slot
    const release1 = await gateway.acquire({ key: "c1:m", limit: 1 });

    const controllerB = new AbortController();
    let bRejected = false;
    const promiseB = gateway
      .acquire({ key: "c1:m", limit: 1 }, controllerB.signal)
      .catch((err: Error) => {
        bRejected = true;
        expect(err.message).toBe("waiter cancelled");
      });

    let cAcquired = false;
    const promiseC = gateway.acquire({ key: "c1:m", limit: 1 }).then((rel) => {
      cAcquired = true;
      return rel;
    });

    // Abort waiter B while in queue
    controllerB.abort(new Error("waiter cancelled"));
    await promiseB;
    expect(bRejected).toBe(true);
    expect(cAcquired).toBe(false);

    // Release slot 1: waiter C should get the slot (not waiter B)
    release1();
    const releaseC = await promiseC;
    expect(cAcquired).toBe(true);
    releaseC();
  });
});
