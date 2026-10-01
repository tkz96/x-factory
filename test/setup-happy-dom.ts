import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

const COUNT_KEY = Symbol.for("happy-dom.registrations");
const FETCH_KEY = Symbol.for("happy-dom.native-fetch");

if (!(FETCH_KEY in globalThis)) {
  (globalThis as Record<symbol, unknown>)[FETCH_KEY] = globalThis.fetch;
}

export function registerHappyDom(): void {
  const currentCount =
    ((globalThis as Record<symbol, unknown>)[COUNT_KEY] as number) || 0;
  if (currentCount === 0) {
    if (!GlobalRegistrator.isRegistered) {
      GlobalRegistrator.register();
    }
    // CRITICAL: Always keep native Bun fetch so backend HTTP tests are never polluted
    globalThis.fetch = (globalThis as Record<symbol, unknown>)[
      FETCH_KEY
    ] as typeof fetch;
  }
  (globalThis as Record<symbol, unknown>)[COUNT_KEY] = currentCount + 1;
}

export async function unregisterHappyDom(): Promise<void> {
  const currentCount =
    ((globalThis as Record<symbol, unknown>)[COUNT_KEY] as number) || 0;
  const nextCount = Math.max(0, currentCount - 1);
  (globalThis as Record<symbol, unknown>)[COUNT_KEY] = nextCount;

  // Unmount any active React components
  try {
    cleanup();
  } catch {}

  if (nextCount === 0) {
    // Allow React 19 scheduler macrotasks/microtasks to drain before removing window
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (((globalThis as Record<symbol, unknown>)[COUNT_KEY] as number) === 0) {
      if (GlobalRegistrator.isRegistered) {
        await GlobalRegistrator.unregister();
      }
      globalThis.fetch = (globalThis as Record<symbol, unknown>)[
        FETCH_KEY
      ] as typeof fetch;
    }
  }
}
