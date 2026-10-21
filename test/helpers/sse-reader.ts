// test/helpers/sse-reader.ts — Reads an SSE response past the stream's opening comment.

/** The comment both SSE streams write before any event (src/http/runs-controller.ts, events-controller.ts). */
export const SSE_OPENING_COMMENT = ": connected\n\n";

/**
 * Reads up to `count` non-comment chunks from an SSE body. The opening comment is dropped; a read
 * that yields only the comment does not count. Stops early when the stream ends.
 */
export async function readSseChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<string[]> {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (chunks.length < count) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    const text = decoder.decode(value).split(SSE_OPENING_COMMENT).join("");
    if (text.length > 0) chunks.push(text);
  }
  return chunks;
}
