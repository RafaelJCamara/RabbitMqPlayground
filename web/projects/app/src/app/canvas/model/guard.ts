/** What the guard needs to know of a key press. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** The keys that this editor gives to Foblex's keyboard layer (ADR-0017): `M` picks up and drops, and `L` links. */
export const GRAB_KEYS: readonly string[] = ['m'];
export const CONNECT_KEYS: readonly string[] = ['l'];

/**
 * Whether Foblex must not see this key (ADR-0017). Its keyboard layer matches the key that picks up a node before it looks at the
 * modifiers, so Ctrl/Cmd+M, which a person means for something else, picks a node up. A key of a single character with a
 * modifier is never a single-key shortcut, so it is held back. Single characters are compared without case, as the library does.
 */
export function blocksFoblex(press: KeyPress, keys: readonly string[] = GRAB_KEYS): boolean {
  return (
    (press.ctrlKey || press.metaKey || press.altKey) &&
    keys.some((key) => key.toLowerCase() === press.key.toLowerCase())
  );
}
