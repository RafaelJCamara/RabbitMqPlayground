/**
 * What kind of file the file pickers take (ADR-0102): only the JSON files that this app writes, a canvas (`.rmq.json`) or a backup. The check is made on what the browser says of the file, the name and
 * the type, before anything is read, and it is what enforces the kind: `accept` on the `<input>` only filters what the picker shows, and a learner can switch the picker to "All files".
 * The name decides, because it is how the browser says what a file is when it has no type: browsers often report a `.json` file with an empty type.
 */

/** A type that a JSON file may have: none, `application/json`, `text/json`, or one of the `+json` types. The parameters (`; charset=utf-8`) do not count. */
function isJsonType(type: string): boolean {
  const essence = (type.split(';')[0] ?? '').trim().toLowerCase();
  return (
    essence === '' ||
    essence === 'application/json' ||
    essence === 'text/json' ||
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+\+json$/.test(essence)
  );
}

/** Whether a file is named `….json` (in any case) and does not say that it is something else. A file that was not given a type by the browser counts as JSON by its name. */
export function isJsonFile(file: { readonly name: string; readonly type?: string }): boolean {
  return file.name.toLowerCase().endsWith('.json') && isJsonType(file.type ?? '');
}

/** Why a file is refused before it is read, in words that say what the app does take, or `null` if it is a JSON file. */
export function refusedKind(file: { readonly name: string; readonly type?: string }): string | null {
  return isJsonFile(file)
    ? null
    : `“${file.name}” is not a JSON file. This app opens only the JSON files it saves: a canvas (.rmq.json) or a backup.`;
}
