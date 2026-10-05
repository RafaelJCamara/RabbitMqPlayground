/**
 * Typed header values and how a headers exchange compares them (ADR-0009). A header value is always tagged with its
 * type, because JavaScript cannot tell `1` from `1.0`, and a headers exchange does.
 */

/** How the arguments of a headers binding are combined. `null` is an `x-match` that was left out, which means `all`. */
export type XMatch = 'all' | 'any' | 'all-with-x' | 'any-with-x';

export type HeaderValue =
  | { readonly t: 'string'; readonly v: string }
  /** An integer of any AMQP width. RabbitMQ compares integers by value, so the width does not matter (ADR-0009). */
  | { readonly t: 'integer'; readonly v: number }
  | { readonly t: 'float'; readonly v: number }
  | { readonly t: 'boolean'; readonly v: boolean };

/** What a headers binding asks of a header: a value to equal, or only that the header is there. */
export type HeaderCondition = HeaderValue | { readonly t: 'exists' };

export interface HeaderEntry<V> {
  readonly key: string;
  readonly value: V;
}

/** The arguments of a binding on a headers exchange. */
export interface HeaderArguments {
  /** `null` when the binding has no `x-match` argument. The broker treats that as `all`. */
  readonly xMatch: XMatch | null;
  readonly args: readonly HeaderEntry<HeaderCondition>[];
}

/**
 * Why `value` cannot be a header value, or `null` when it can. An integer is a JavaScript number, which holds a whole
 * number exactly only up to 2^53 - 1, and an int64 header beyond that cannot be told from its neighbours. So an integer
 * that is not a safe one is refused, here and by every editor and importer that builds a value, and nothing is rounded
 * quietly (ADR-0023). A float has to be finite, because JSON cannot write anything else.
 */
export function headerValueIssue(value: HeaderCondition): string | null {
  if (value.t === 'integer' && !Number.isSafeInteger(value.v)) {
    return `An integer header must be a whole number from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}, because a JavaScript number cannot tell larger ones apart`;
  }
  if (value.t === 'float' && !Number.isFinite(value.v)) {
    return 'A float header must be a finite number';
  }
  return null;
}

/** Why a condition failed. */
export type ConditionFailure = 'missing' | 'value-differs' | 'type-differs';

/** What became of one argument of a binding. */
export interface ConditionResult {
  readonly key: string;
  readonly expected: HeaderCondition;
  /** What the message had under that key. Left out when it had nothing. */
  readonly actual?: HeaderValue;
  /** `ignored` is an `x-` argument under `all` or `any`: it takes no part. */
  readonly outcome: 'pass' | 'fail' | 'ignored';
  /** Why the condition failed. Only for `fail`. */
  readonly reason?: ConditionFailure;
}

/** How a headers binding judged a message, argument by argument. */
export interface HeadersMatch {
  /** The mode in force: `all` when the binding left `x-match` out. */
  readonly xMatch: XMatch;
  /** The binding left `x-match` out. */
  readonly omitted: boolean;
  readonly requires: 'all' | 'any';
  /** `x-` arguments count (the `*-with-x` modes). */
  readonly withX: boolean;
  /** Every argument of the binding, in order, each judged on its own, even after the outcome is known. */
  readonly conditions: readonly ConditionResult[];
  /** How many arguments took part. */
  readonly counted: number;
  readonly passed: number;
  /**
   * With nothing counted, `all` matches every message and `any` matches none (ADR-0009). Otherwise `all` needs every
   * counted argument to pass and `any` needs one.
   */
  readonly matched: boolean;
}

function judge(
  expected: HeaderCondition,
  actual: HeaderValue | undefined,
): Pick<ConditionResult, 'outcome' | 'reason'> {
  if (actual === undefined) {
    return { outcome: 'fail', reason: 'missing' };
  }
  if (expected.t === 'exists') {
    return { outcome: 'pass' };
  }
  if (expected.t !== actual.t) {
    return { outcome: 'fail', reason: 'type-differs' };
  }
  return expected.v === actual.v ? { outcome: 'pass' } : { outcome: 'fail', reason: 'value-differs' };
}

/**
 * Judges a message's headers against the arguments of a headers binding (ADR-0009). The routing key plays no part.
 * Which arguments count depends on the mode: `all` and `any` leave out the `x-` ones, and `all-with-x` and `any-with-x`
 * count them. A message that repeats a key is read by its first header of that key.
 */
export function matchHeaders(
  binding: HeaderArguments | undefined,
  headers: readonly HeaderEntry<HeaderValue>[],
): HeadersMatch {
  const xMatch = binding?.xMatch ?? 'all';
  const requires = xMatch === 'all' || xMatch === 'all-with-x' ? 'all' : 'any';
  const withX = xMatch === 'all-with-x' || xMatch === 'any-with-x';

  const conditions = (binding?.args ?? []).map(({ key, value }): ConditionResult => {
    const actual = headers.find((header) => header.key === key)?.value;
    const base = { key, expected: value, ...(actual === undefined ? {} : { actual }) };
    return !withX && key.startsWith('x-') ? { ...base, outcome: 'ignored' } : { ...base, ...judge(value, actual) };
  });

  const counted = conditions.filter((condition) => condition.outcome !== 'ignored').length;
  const passed = conditions.filter((condition) => condition.outcome === 'pass').length;
  const matched = counted === 0 ? requires === 'all' : requires === 'all' ? passed === counted : passed > 0;

  return { xMatch, omitted: binding?.xMatch == null, requires, withX, conditions, counted, passed, matched };
}
