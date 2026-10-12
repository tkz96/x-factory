// src/frontend/motion/motion-feature-pack.ts — the motion features the app uses.
//
// This module is only ever reached through the dynamic import in
// motion-features.ts, so the feature pack lands in its own chunk and the entry
// bundle stays without it. `domMax` is the smallest pack that covers the
// features in use (#252): entry/exit for the chat, and `layout` for list
// reordering. Sheets animate in CSS and nothing drags. No other module imports
// a feature pack, and `bun run test:frontend-smoke` enforces that.

import { domMax } from "motion/react";

export default domMax;
