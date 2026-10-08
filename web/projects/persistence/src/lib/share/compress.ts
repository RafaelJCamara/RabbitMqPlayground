/**
 * Deflate and inflate (RFC 1951, no header, no checksum) on the platform's own streams (ADR-0077). The browser and Node both have them, so the same code runs in a page and in a
 * spec. A stream is read as it comes, so the size of what a link opens into is counted before it is made, and a link that opens into too much is stopped and not inflated.
 */

/** Whether this platform can compress, which a very old browser cannot. */
export const canCompress = (): boolean =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

interface Chunks {
  readonly chunks: readonly Uint8Array[];
  /** How many bytes had been read when the reading stopped. */
  readonly seen: number;
  /** The stream had more than `limit` bytes, and was cancelled without making the rest. */
  readonly over: boolean;
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Chunks> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { chunks, seen, over: false };
    }
    seen += value.length;
    if (seen > limit) {
      await reader.cancel();
      return { chunks, seen, over: true };
    }
    chunks.push(value);
  }
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The bytes, compressed. They are a few kilobytes at most, because the text was kept under the cap first. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return join((await readAll(stream as ReadableStream<Uint8Array>, Infinity)).chunks);
}

export type Inflated =
  | { readonly ok: true; readonly bytes: Uint8Array }
  /** It opens into more than `limit` bytes. `seen` is how many had been made when it was stopped. */
  | { readonly ok: false; readonly reason: 'too-large'; readonly seen: number }
  /** The stream is not a deflate stream, or is cut short, and what the platform said. */
  | { readonly ok: false; readonly reason: 'damaged'; readonly detail: string };

/** Inflates, and stops at `limit` bytes without making the rest. */
export async function inflate(bytes: Uint8Array, limit: number): Promise<Inflated> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const { chunks, seen, over } = await readAll(stream as ReadableStream<Uint8Array>, limit);
    return over ? { ok: false, reason: 'too-large', seen } : { ok: true, bytes: join(chunks) };
  } catch (error) {
    // What the platform said, without the full stop that it may end with, because the sentence it goes into has its own.
    const said = error instanceof Error ? error.message.replace(/[.\s]+$/, '') : '';
    return { ok: false, reason: 'damaged', detail: said === '' ? 'the stream could not be inflated' : said };
  }
}
