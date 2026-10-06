// test/fixtures/native-web-globals.ts — keeps the runtime's own fetch family
// available to a real server running inside a happy-dom test.
//
// `GlobalRegistrator.register()` replaces the fetch family (`fetch`, `Request`,
// `Response`, `Headers`) with happy-dom's. `test/setup-happy-dom.ts` restores
// the native `fetch` so backend calls are never polluted — but a Bun server
// running in the same process builds its responses with the GLOBAL `Response`,
// and Bun rejects a happy-dom `Response` ("Expected a Response object").
//
// Import this module BEFORE `setup-happy-dom.js` to capture the natives, then
// call `restoreNativeResponseGlobals()` after registering.

const NATIVE = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
};

/** Puts the runtime's own fetch family back, leaving happy-dom's DOM in place. */
export function restoreNativeResponseGlobals(): void {
  globalThis.fetch = NATIVE.fetch;
  globalThis.Request = NATIVE.Request;
  globalThis.Response = NATIVE.Response;
  globalThis.Headers = NATIVE.Headers;
}
