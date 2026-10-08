import { formatBytes, SIZE_CAPS } from '@rmq/persistence';

/**
 * Reading the file that a learner chose (ADR-0075). The cap of the persistence library is 50,000,000 characters of text, which is at most four bytes each, so a file over
 * 200 MB cannot be a canvas file or a backup, and is not read at all: reading it is what could make the page run out of memory, and the loader would only then say that it is too big.
 */
export const MAX_FILE_BYTES = 4 * SIZE_CAPS.file;

/** Why a file is too big to be read, in words, or `null` if it is not. */
export function tooBigToRead(file: { readonly size: number }): string | null {
  return file.size > MAX_FILE_BYTES
    ? `This file is ${formatBytes(file.size)}, which is more than a canvas file or a backup of this app can be (at most ${formatBytes(SIZE_CAPS.file)} of text). It was not read, so that a file that is not one of ours cannot make the page run out of memory.`
    : null;
}

/** The text of a file, as UTF-8. */
export function readText(file: Blob): Promise<string> {
  return file.text();
}
