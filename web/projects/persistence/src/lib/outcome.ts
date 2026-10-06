import type { RepositoryError } from './errors';

/**
 * What a call that can fail answers: the value, or an error that says what went wrong. Nothing in this library throws for
 * data that someone else made or for what a browser refuses to do, because both are expected answers that a screen shows
 * (ADR-0027, ADR-0028). By default the error is a `RepositoryError`.
 */
export type Outcome<T, E = RepositoryError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const succeed = <T>(value: T): Outcome<T, never> => ({ ok: true, value });
export const failure = <E>(error: E): Outcome<never, E> => ({ ok: false, error });
