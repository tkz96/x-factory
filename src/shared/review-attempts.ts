// src/shared/review-attempts.ts — How many times the review is tried when the provider fails
// transiently. Only the review repeats: the code was already verified, so a retry of the whole
// job would rerun coding. One constant for the executor and every line of copy that mentions it.

export const REVIEW_ATTEMPTS = 3;
