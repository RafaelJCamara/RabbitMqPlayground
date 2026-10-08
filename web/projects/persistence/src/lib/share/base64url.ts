/**
 * Base64url (RFC 4648, section 5) without padding, written out because the platform's `btoa` and `atob` are about text and not about bytes, and
 * because Node and some browsers read the characters that they do not know without a word, where a share link has to refuse them (ADR-0077).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The value of each character of the alphabet, by its code. A character that is not in it is -1. */
const VALUES = new Int8Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) {
  VALUES[ALPHABET.charCodeAt(index)] = index;
}

/** The value of the character with this code, or -1 when it is not one of the alphabet, as every code from 128 up is not. */
const valueOf = (code: number): number => (code < 128 ? (VALUES[code] as number) : -1);

export function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] as number;
    const second = bytes[at + 1] ?? 0;
    const third = bytes[at + 2] ?? 0;
    const left = bytes.length - at;
    text += ALPHABET.charAt(first >> 2);
    text += ALPHABET.charAt(((first & 3) << 4) | (second >> 4));
    if (left > 1) {
      text += ALPHABET.charAt(((second & 15) << 2) | (third >> 6));
    }
    if (left > 2) {
      text += ALPHABET.charAt(third & 63);
    }
  }
  return text;
}

export type Decoded =
  | { readonly ok: true; readonly bytes: Uint8Array }
  /** A character that is not in the alphabet, and where it is: the place in the text, counting from 0, and the whole character, which may be an emoji of two units. */
  | { readonly ok: false; readonly reason: 'alphabet'; readonly at: number; readonly char: string }
  /** A length that no base64 text has: one character more than a whole number of groups of four. */
  | { readonly ok: false; readonly reason: 'length' };

export function fromBase64Url(text: string): Decoded {
  for (let at = 0; at < text.length; at += 1) {
    if (valueOf(text.charCodeAt(at)) < 0) {
      return { ok: false, reason: 'alphabet', at, char: String.fromCodePoint(text.codePointAt(at) as number) };
    }
  }
  if (text.length % 4 === 1) {
    return { ok: false, reason: 'length' };
  }
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  const value = (at: number): number => valueOf(text.charCodeAt(at));
  let out = 0;
  for (let at = 0; at < text.length; at += 4) {
    // The last group may have two or three characters. Past the end of the text a character has no value, and what would be made of it is a write past the end of `bytes`, which a typed array drops.
    const a = value(at);
    const b = value(at + 1);
    const c = value(at + 2);
    const d = value(at + 3);
    bytes[out++] = (a << 2) | (b >> 4);
    bytes[out++] = ((b & 15) << 4) | (c >> 2);
    bytes[out++] = ((c & 3) << 6) | d;
  }
  return { ok: true, bytes };
}
