// src/frontend/lib/setup-later.ts — Remembers "I'll set up later" on the welcome.
//
// A per-browser convenience, like the appearance setting: once the user leaves
// the welcome, the app's landing takes them to Tickets instead of back to the
// welcome while setup is still incomplete. The welcome stays reachable at
// /welcome. Storage can be unavailable (private windows, blocked site data);
// then the button still leaves the welcome, but the landing asks again.

const STORAGE_KEY = "x-factory.setup-later";

export function deferSetup(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, "true");
  } catch {
    // Storage unavailable: the landing will show the welcome again.
  }
}

export function isSetupDeferred(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
