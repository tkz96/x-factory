// src/http/sse-timing.ts — Timing shared by every long-lived SSE stream and the HTTP server.
//
// Bun closes a socket that has been silent for `idleTimeout` seconds. Each stream writes a keep-alive
// comment every SSE_KEEPALIVE_MS, so the idle timeout must stay comfortably above that interval, or a
// quiet stream is dropped and the browser reconnects every ~10 s. Bun's default is 10 s, which is why
// `Bun.serve` sets it explicitly in src/server.ts. Bun caps `idleTimeout` at 255 seconds.

/** Keep-alive comment interval for the run stream and the app-wide stream. */
export const SSE_KEEPALIVE_MS = 15_000;

/** Seconds of socket silence Bun tolerates before it closes a connection. Must exceed SSE_KEEPALIVE_MS. */
export const SERVER_IDLE_TIMEOUT_S = 60;
