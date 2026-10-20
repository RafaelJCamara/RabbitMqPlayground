import { failure, succeed, type Outcome } from '../outcome';

/**
 * A reader of JSON (RFC 8259) for the import of a definitions file (ADR-0111), which keeps what `JSON.parse` loses: whether a number was written
 * as a whole number or with a fraction or an exponent. RabbitMQ keeps `1` and `1.0` apart in the arguments of a binding (ADR-0009), and the export
 * writes a float as `1.0` for that reason (ADR-0079), so the import has to read it back as one. It never throws: text that is not JSON is an answer.
 */

/** A number as it was written. `float` is whether it has a fraction or an exponent. */
export class JsonNumber {
  constructor(
    readonly value: number,
    readonly float: boolean,
  ) {}
}

export type JsonValue = null | boolean | string | JsonNumber | readonly JsonValue[] | JsonObject;

/**
 * An object of JSON, as a map: its keys stay in the order of the file, which an object of JavaScript does not keep for a key such as `"10"`, and a key
 * such as `__proto__` is a key like any other. A key that is there twice has its last value, where it was first, as in `JSON.parse`.
 */
export type JsonObject = ReadonlyMap<string, JsonValue>;

/** How deep arrays and objects can be inside each other. A definitions file is four deep; this is far more, and keeps hostile text from the end of the stack. */
export const MAX_JSON_DEPTH = 64;

class NotJson extends Error {}

const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  document(): JsonValue {
    const value = this.value(0);
    this.space();
    if (this.at < this.text.length) {
      this.fail('there is more after the end of the JSON');
    }
    return value;
  }

  private fail(what: string): never {
    throw new NotJson(`${what}, at character ${this.at + 1}`);
  }

  private space(): void {
    while (this.at < this.text.length && ' \t\n\r'.includes(this.text.charAt(this.at))) {
      this.at++;
    }
  }

  private value(depth: number): JsonValue {
    this.space();
    const next = this.text.charAt(this.at);
    if (next === '{' || next === '[') {
      if (depth >= MAX_JSON_DEPTH) {
        this.fail(`it is nested more than ${MAX_JSON_DEPTH} deep`);
      }
      return next === '{' ? this.object(depth + 1) : this.array(depth + 1);
    }
    if (next === '"') {
      return this.string();
    }
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.text.startsWith(word, this.at)) {
        this.at += word.length;
        return value;
      }
    }
    return this.number();
  }

  private object(depth: number): JsonObject {
    const object = new Map<string, JsonValue>();
    this.at++;
    this.space();
    if (this.text.charAt(this.at) === '}') {
      this.at++;
      return object;
    }
    for (;;) {
      this.space();
      if (this.at >= this.text.length) {
        this.fail('the text ends before the object does');
      }
      if (this.text.charAt(this.at) !== '"') {
        this.fail('a key of an object has to be a string');
      }
      const key = this.string();
      this.space();
      if (this.text.charAt(this.at) !== ':') {
        this.fail('a key of an object has to be followed by ":"');
      }
      this.at++;
      object.set(key, this.value(depth));
      this.space();
      const after = this.text.charAt(this.at++);
      if (after === '}') {
        return object;
      }
      if (after !== ',') {
        this.at--;
        this.fail('an object needs "," between its members, and "}" at its end');
      }
    }
  }

  private array(depth: number): JsonValue[] {
    const array: JsonValue[] = [];
    this.at++;
    this.space();
    if (this.text.charAt(this.at) === ']') {
      this.at++;
      return array;
    }
    for (;;) {
      array.push(this.value(depth));
      this.space();
      const after = this.text.charAt(this.at++);
      if (after === ']') {
        return array;
      }
      if (after !== ',') {
        this.at--;
        this.fail('an array needs "," between its items, and "]" at its end');
      }
    }
  }

  private string(): string {
    this.at++;
    let out = '';
    for (;;) {
      if (this.at >= this.text.length) {
        this.fail('a string is not closed');
      }
      const char = this.text.charAt(this.at++);
      if (char === '"') {
        return out;
      }
      if (char < ' ') {
        this.at--;
        this.fail('a string cannot have a control character in it unless it is escaped');
      }
      if (char !== '\\') {
        out += char;
        continue;
      }
      const escape = this.text.charAt(this.at++);
      if (escape === 'u') {
        const hex = this.text.slice(this.at, this.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.fail('\\u has to be followed by four hexadecimal digits');
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.at += 4;
      } else if (Object.hasOwn(ESCAPES, escape)) {
        out += ESCAPES[escape];
      } else {
        this.at--;
        this.fail(`"\\${escape}" is not an escape of JSON`);
      }
    }
  }

  private number(): JsonNumber {
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.text);
    if (match === null) {
      this.fail(this.at >= this.text.length ? 'the text ends where a value was expected' : 'a value was expected');
    }
    this.at = NUMBER.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      this.fail('a number is too large');
    }
    return new JsonNumber(value, match[1] !== undefined || match[2] !== undefined);
  }
}

/** The JSON value of the text, or why it is not JSON, in words, with the place where the reader stopped. */
export function readJson(text: string): Outcome<JsonValue, string> {
  try {
    return succeed(new Reader(text).document());
  } catch (error) {
    if (error instanceof NotJson) {
      return failure(error.message);
    }
    throw error;
  }
}

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => value instanceof Map;
