import {
  newerVersion,
  notALink,
  damagedLink,
  reasonOf,
  tooLarge,
  unsupportedBrowser,
  type ShareError,
} from '../errors';
import { SHARE_FORMAT, SHARE_VERSION } from '../files/formats';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import { fromBase64Url, toBase64Url } from './base64url';
import { canCompress, deflate, inflate } from './compress';
import { readShare, type Shared } from './share';

/**
 * The share link (ADR-0013, ADR-0077): `<base>#c=<payload>`, where the payload is `v1.` and the base64url of the deflated text of an envelope. `encodeShare` makes the payload and
 * reads back what it made, as `writeCanvasFile` does, so the app never makes a link that it would refuse to open; `decodeShare` takes it apart in the order that keeps a hostile
 * link small: the length of the text, its prefix, its alphabet, an inflation that stops at the cap, the UTF-8, the JSON, the envelope, and then the loader.
 */

/** What every link of this format starts with. A number above 1 is a newer link. */
export const SHARE_PREFIX = `v${SHARE_VERSION}.`;

/** The name of the fragment that holds the payload: `#c=`. */
export const SHARE_KEY = 'c';

/** Above this many characters in the whole link, chat apps and mail clients begin to cut it (ADR-0013), and the panel offers a file instead. */
export const SHARE_WARN_AT = 8_000;

/** The start of a link: `v`, a whole number from 1 with no zero in front and at most six digits, and a point. What comes after it depends on that number. */
const VERSION_PREFIX = /^v([1-9]\d{0,5})\./;

/** The address that a payload is opened at: the page that makes it, and the fragment. A query is not carried (ADR-0077). */
export const shareLink = (base: string, payload: string): string => `${base}#${SHARE_KEY}=${payload}`;

/** The payload that a fragment holds (`#c=…` or `c=…`), or `undefined` when it holds none. */
export function payloadOf(fragment: string): string | undefined {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  return text.startsWith(`${SHARE_KEY}=`) ? text.slice(SHARE_KEY.length + 1) : undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The text of the envelope: compact, with its keys in a fixed order, so that one canvas gives one text. */
function envelopeText(shared: Shared): string {
  return JSON.stringify({
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    name: shared.name,
    document: shared.document,
    // JSON leaves out a key that has no value.
    simulation: shared.simulation,
  });
}

/** Makes the payload of a link for a canvas. It fails with the sentence that says why when the canvas cannot be a link that this app would open. */
export async function encodeShare(shared: Shared): Promise<Outcome<string, ShareError>> {
  if (!canCompress()) {
    return failure(unsupportedBrowser());
  }
  const text = envelopeText(shared);
  // What the link will say is read the way that it will be: from the text, which is JSON, and not from the objects.
  const read = readShare(JSON.parse(text));
  if (!read.ok) {
    return failure(read.error);
  }
  const bytes = encoder.encode(text);
  if (bytes.length > SIZE_CAPS.inflated) {
    return failure(tooLarge('inflated', bytes.length, SIZE_CAPS.inflated));
  }
  const payload = `${SHARE_PREFIX}${toBase64Url(await deflate(bytes))}`;
  return payload.length > SIZE_CAPS.link ? failure(tooLarge('link', payload.length, SIZE_CAPS.link)) : succeed(payload);
}

/** Opens the payload of a link. It never throws, and it never makes more than the cap of text, however small the link. */
export async function decodeShare(payload: string): Promise<Outcome<Shared, ShareError>> {
  if (typeof payload !== 'string') {
    return failure(notALink('it is not text'));
  }
  if (payload.length > SIZE_CAPS.link) {
    return failure(tooLarge('link', payload.length, SIZE_CAPS.link));
  }
  const prefix = VERSION_PREFIX.exec(payload);
  if (prefix === null) {
    return failure(notALink(`it does not start with “${SHARE_PREFIX}”, as every link of this app does`));
  }
  const version = Number(prefix[1]);
  if (version > SHARE_VERSION) {
    return failure(newerVersion('link', version, SHARE_VERSION));
  }
  const body = payload.slice(SHARE_PREFIX.length);
  if (body === '') {
    return failure(notALink(`there is nothing after “${SHARE_PREFIX}”`));
  }
  const bytes = fromBase64Url(body);
  if (!bytes.ok) {
    return failure(
      bytes.reason === 'alphabet'
        ? notALink(
            `it has a character that a link never has (${JSON.stringify(bytes.char)} at place ${bytes.at + SHARE_PREFIX.length + 1} after “#${SHARE_KEY}=”)`,
          )
        : damagedLink('its length is not one that a link can have'),
    );
  }
  if (!canCompress()) {
    return failure(unsupportedBrowser());
  }
  const inflated = await inflate(bytes.bytes, SIZE_CAPS.inflated);
  if (!inflated.ok) {
    return failure(
      inflated.reason === 'too-large'
        ? tooLarge('inflated', inflated.seen, SIZE_CAPS.inflated)
        : damagedLink(`it could not be unpacked (${inflated.detail})`),
    );
  }
  let text: string;
  try {
    text = decoder.decode(inflated.bytes);
  } catch {
    return failure(damagedLink('what it holds is not text'));
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return failure(damagedLink(`what it holds is not JSON (${reasonOf(error)})`));
  }
  return readShare(data);
}
