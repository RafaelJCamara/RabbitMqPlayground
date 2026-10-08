import {
  newerVersion,
  notAnObject,
  notJson,
  reasonOf,
  summarise,
  tooLarge,
  unknownFormat,
  type LoadError,
  type VersionOf,
} from '../errors';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import { isRecord, type Raw } from '../shape';

/**
 * What a file of one canvas and a backup have in common (ADR-0027): they are JSON text, in an envelope that says what it is
 * (`format`) and which version of the envelope it is (`version`). That version is not the schema version of the documents in it.
 */

export interface EnvelopeKind {
  /** What the envelope says it is, for example `rmq-playground/canvas`. */
  readonly format: string;
  /** The version of the envelope that this app writes, and reads up to. */
  readonly version: number;
  readonly of: Exclude<VersionOf, 'schema'>;
  /** What it is called in a sentence: `canvas file`, `backup`. */
  readonly noun: string;
  /** The other kinds of envelope that this app writes, and what to say to someone who has opened one of them by mistake. */
  readonly mistaken: readonly { readonly format: string; readonly message: string }[];
}

/** What some editors put at the start of a UTF-8 file. It is not a part of the JSON. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * Text that is to be an envelope. It is refused if it is longer than the cap, before anything reads it, and a byte order mark,
 * which some editors put at the start of a UTF-8 file, is not a part of the JSON.
 */
export function parseJsonText(text: unknown): Outcome<unknown, LoadError> {
  if (typeof text !== 'string') {
    return failure(notJson(`it is not text, it is ${summarise(text)}`));
  }
  if (text.length > SIZE_CAPS.file) {
    return failure(tooLarge('file', text.length, SIZE_CAPS.file));
  }
  try {
    return succeed(JSON.parse(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text));
  } catch (error) {
    return failure(notJson(reasonOf(error)));
  }
}

/** Is this data an envelope of this kind, of a version that this app can read? It does not look at what is inside. */
export function checkEnvelope(data: unknown, kind: EnvelopeKind): Outcome<Raw, LoadError> {
  if (!isRecord(data)) {
    return failure(notAnObject(data));
  }

  const format = data['format'];
  const mistaken = kind.mistaken.find((other) => other.format === format);
  if (mistaken !== undefined) {
    return failure(unknownFormat(mistaken.message));
  }
  if (format !== kind.format) {
    const found = format === undefined ? 'it does not say what it is.' : `its format is ${summarise(format)}.`;
    return failure(
      unknownFormat(
        `This is not a ${kind.noun} of this app: ${found} A ${kind.noun} has "format": "${kind.format}" at the top.`,
      ),
    );
  }

  const version = data['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return failure(
      unknownFormat(
        `This is not a ${kind.noun} of this app: its format version is ${summarise(version)}, and a format version is a whole number from 1.`,
      ),
    );
  }
  if (version > kind.version) {
    return failure(newerVersion(kind.of, version, kind.version));
  }
  return succeed(data);
}
