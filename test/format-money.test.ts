// test/format-money.test.ts — One way to write a dollar amount: two decimals at
// least, and more only when the amount is below a cent, so a small cost never
// reads as "$0.0" or with a stray third decimal.

import { describe, expect, it } from "bun:test";
import { formatUsd } from "../src/frontend/lib/format-money.js";

describe("formatUsd", () => {
  it("writes whole cents with exactly two decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.05)).toBe("$0.05");
    expect(formatUsd(0.047)).toBe("$0.05");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("keeps two significant digits below a cent, without trailing zeros", () => {
    expect(formatUsd(0.0047)).toBe("$0.0047");
    expect(formatUsd(0.0062)).toBe("$0.0062");
    expect(formatUsd(0.001)).toBe("$0.001");
    expect(formatUsd(0.000012345)).toBe("$0.000012");
  });

  it("does not round a sub-cent amount up to a cent it never cost", () => {
    expect(formatUsd(0.00999)).toBe("$0.01");
    expect(formatUsd(0.0099)).toBe("$0.0099");
  });

  it("treats an amount that is not a finite number as zero", () => {
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});
