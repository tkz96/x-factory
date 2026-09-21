// src/http/sse-registry.ts — In-memory registry for tracking and cleanly terminating active SSE connections (Phase 2, Section 37).

export class SSEStreamRegistry {
  private activeStreams = new Set<() => void>();

  /**
   * Registers a stream cleanup callback and returns an unregister function.
   */
  register(closeFn: () => void): () => void {
    this.activeStreams.add(closeFn);
    return () => {
      this.activeStreams.delete(closeFn);
    };
  }

  /**
   * Closes all active SSE connections during server shutdown.
   */
  closeAll(): void {
    for (const closeFn of this.activeStreams) {
      try {
        closeFn();
      } catch {
        // ignore errors during shutdown
      }
    }
    this.activeStreams.clear();
  }

  get count(): number {
    return this.activeStreams.size;
  }
}

export const defaultSSERegistry = new SSEStreamRegistry();
