// src/frontend/motion/motion-features.ts — the lazy entry point to the motion bundle.
//
// LazyMotion takes a function that returns a promise, so passing this one means
// the feature pack is fetched the first time a motion component renders instead
// of on every page load (#252).

import type { FeatureBundle } from "motion/react";

export function loadMotionFeatures(): Promise<FeatureBundle> {
  return import("./motion-feature-pack.js").then((pack) => pack.default);
}
