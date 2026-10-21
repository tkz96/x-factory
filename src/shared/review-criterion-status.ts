// src/shared/review-criterion-status.ts — The verdict of one stored review criterion.
//
// Pure and import-free, so the server and the browser read a stored review the
// same way. A review stored before `status` existed has `satisfied: boolean`
// instead; a criterion with neither was never judged, so it is not assessed.

import type { ReviewCriterionResult, ReviewCriterionStatus } from "./types.js";

export function reviewCriterionStatus(
  check: Pick<ReviewCriterionResult, "criterion" | "status" | "satisfied">,
): ReviewCriterionStatus {
  if (check.status) return check.status;
  if (check.satisfied === true) return "pass";
  if (check.satisfied === false) return "fail";
  return "not_assessed";
}
