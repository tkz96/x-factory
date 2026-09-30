import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;

GlobalRegistrator.register({ url: "http://localhost:3000" });

// Restore native fetch for Bun so backend tests don't break
globalThis.fetch = nativeFetch;
globalThis.Request = nativeRequest;
globalThis.Response = nativeResponse;
globalThis.Headers = nativeHeaders;
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
  true;
(global as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    true;
}

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("act(...)")) return;
  originalConsoleError(...args);
};
