// test/review-criterion-status.test.ts — How a stored criterion's verdict is read, including the
// reviews stored before `status` existed (they carry `satisfied: boolean`).

import { describe, expect, it } from "bun:test";
import { reviewCriterionStatus } from "../src/shared/review-criterion-status.js";

describe("reviewCriterionStatus", () => {
  it("reads the status a criterion was stored with", () => {
    expect(reviewCriterionStatus({ criterion: "A", status: "pass" })).toBe(
      "pass",
    );
    expect(reviewCriterionStatus({ criterion: "A", status: "fail" })).toBe(
      "fail",
    );
    expect(
      reviewCriterionStatus({ criterion: "A", status: "not_assessed" }),
    ).toBe("not_assessed");
  });

  it("prefers the status over a legacy satisfied flag when both are present", () => {
    expect(
      reviewCriterionStatus({
        criterion: "A",
        status: "fail",
        satisfied: true,
      }),
    ).toBe("fail");
  });

  it("reads a legacy satisfied: true as pass and satisfied: false as fail", () => {
    expect(reviewCriterionStatus({ criterion: "A", satisfied: true })).toBe(
      "pass",
    );
    expect(reviewCriterionStatus({ criterion: "A", satisfied: false })).toBe(
      "fail",
    );
  });

  it("reads a criterion with neither a status nor a satisfied flag as not assessed, never a pass", () => {
    expect(reviewCriterionStatus({ criterion: "A" })).toBe("not_assessed");
  });
});
