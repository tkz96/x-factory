// test/feedback-derive-async-state.test.ts — Pure-function tests for the
// state-derivation helper: precedence (stale > loading > error > partial >
// empty) and the never-discards-diagnostics rule (spec #133 §Testing).

import { describe, expect, it } from "bun:test";
import { deriveAsyncState } from "../src/frontend/components/feedback/derive-async-state.js";
import type { AsyncQueryLike } from "../src/frontend/components/feedback/types.js";

function query(overrides: Partial<AsyncQueryLike> = {}): AsyncQueryLike {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: undefined,
    ...overrides,
  };
}

describe("deriveAsyncState — precedence & diagnostics", () => {
  it("derives loading for an initial fetch with no result yet", () => {
    expect(deriveAsyncState(query({ isPending: true }))).toEqual({
      state: "loading",
      suppressed: [],
      error: undefined,
    });
  });

  it("derives ready for a successful query with no flags raised", () => {
    const derived = deriveAsyncState(query({ data: [{ id: "p1" }] }));
    expect(derived.state).toBe("ready");
    expect(derived.suppressed).toEqual([]);
  });

  it("derives empty when the caller's isEmpty predicate is true", () => {
    const derived = deriveAsyncState(query({ data: [] }), {
      isEmpty: (q) => Array.isArray(q.data) && q.data.length === 0,
    });
    expect(derived.state).toBe("empty");
    expect(derived.suppressed).toEqual([]);
  });

  it("partial outranks empty", () => {
    const derived = deriveAsyncState(query({ data: [{ id: "p1" }] }), {
      isEmpty: () => true,
      isPartial: () => true,
    });
    expect(derived.state).toBe("partial");
    expect(derived.suppressed).toEqual(["empty"]);
  });

  it("derives error with the payload when the query failed with nothing to show", () => {
    const failure = { code: "AUTH_INVALID", context: "VERIFY" };
    const derived = deriveAsyncState(query({ isError: true, error: failure }));
    expect(derived.state).toBe("error");
    expect(derived.suppressed).toEqual([]);
    expect(derived.error).toBe(failure);
  });

  it("error outranks partial and empty, suppressing both in precedence order", () => {
    const derived = deriveAsyncState(query({ isError: true }), {
      isPartial: () => true,
      isEmpty: () => true,
    });
    expect(derived.state).toBe("error");
    expect(derived.suppressed).toEqual(["partial", "empty"]);
  });

  it("stale outranks an in-flight initial fetch", () => {
    const derived = deriveAsyncState(query({ isPending: true }), {
      isStale: () => true,
    });
    expect(derived.state).toBe("stale");
    expect(derived.suppressed).toEqual(["loading"]);
  });

  it("stale + failed refresh → stale state with error suppressed alongside it", () => {
    const failure = { code: "RATE_LIMITED", context: "DISCOVERY" };
    const derived = deriveAsyncState(
      query({ data: [{ id: "r1" }], isError: true, error: failure }),
      { isStale: () => true },
    );
    expect(derived.state).toBe("stale");
    expect(derived.suppressed).toEqual(["error"]);
    expect(derived.error).toBe(failure);
  });

  it("a failed refresh with data and no other flag derives ready with the error suppressed", () => {
    const derived = deriveAsyncState(
      query({ data: [{ id: "r1" }], isError: true, error: new Error("boom") }),
    );
    expect(derived.state).toBe("ready");
    expect(derived.suppressed).toEqual(["error"]);
  });

  it("a failed refresh with data and partial results derives partial with the error suppressed", () => {
    const derived = deriveAsyncState(
      query({ data: [{ id: "r1" }], isError: true }),
      { isPartial: () => true },
    );
    expect(derived.state).toBe("partial");
    expect(derived.suppressed).toEqual(["error"]);
  });

  it("null data counts as a displayed result (failed refresh, not a dead region)", () => {
    const derived = deriveAsyncState(query({ data: null, isError: true }));
    expect(derived.state).toBe("ready");
    expect(derived.suppressed).toEqual(["error"]);
  });

  it("stale outranks every other condition and suppresses the rest in precedence order", () => {
    const derived = deriveAsyncState(
      query({
        data: [{ id: "r1" }],
        isError: true,
        error: { code: "UNKNOWN", context: "TICKETS" },
      }),
      { isStale: () => true, isPartial: () => true, isEmpty: () => true },
    );
    expect(derived.state).toBe("stale");
    expect(derived.suppressed).toEqual(["error", "partial", "empty"]);
  });

  it("keeps the error payload available even when error is suppressed", () => {
    const failure = { code: "PERMISSION", context: "PR" };
    const derived = deriveAsyncState(
      query({ data: [{ id: "r1" }], isError: true, error: failure }),
      { isStale: () => true },
    );
    expect(derived.state).toBe("stale");
    expect(derived.error).toBe(failure);
  });

  it("consults every predicate so the suppressed list is complete", () => {
    const calls: string[] = [];
    const derived = deriveAsyncState(query({ data: [{ id: "r1" }] }), {
      isEmpty: () => {
        calls.push("empty");
        return false;
      },
      isPartial: () => {
        calls.push("partial");
        return false;
      },
      isStale: () => {
        calls.push("stale");
        return false;
      },
    });
    expect(derived.state).toBe("ready");
    expect(calls).toEqual(["stale", "partial", "empty"]);
  });
});
