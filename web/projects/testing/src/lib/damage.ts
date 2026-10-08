import * as fc from 'fast-check';

/**
 * Ways to damage a tree of JSON, for properties about what reads data that nothing vouches for (ADR-0015, ADR-0027, ADR-0077). `arbDamage` damages it anywhere and in any way, so a reader has to say what is wrong with
 * a shape that is not its own. `arbTypedDamage` keeps the types and changes the facts: a name becomes another name, a number becomes the next one, a list loses an element or has one twice. That is the damage that a
 * schema cannot see, and that the code behind it has to.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Path = readonly (string | number)[];

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every place in a tree of JSON, the root included. */
export function pathsOf(value: Json | undefined, prefix: Path = []): Path[] {
  if (Array.isArray(value)) {
    return [prefix, ...value.flatMap((inner, index) => pathsOf(inner, [...prefix, index]))];
  }
  if (isObject(value)) {
    return [prefix, ...Object.entries(value).flatMap(([key, inner]) => pathsOf(inner, [...prefix, key]))];
  }
  return [prefix];
}

export const at = (root: Json | undefined, path: Path): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], root);

/** A copy of the tree with the node at the path replaced by what `change` makes of it. */
export function edit(root: Json | undefined, path: Path, change: (node: unknown) => unknown): unknown {
  if (path.length === 0) {
    return change(root);
  }
  const copy = structuredClone(root) as Record<string | number, unknown>;
  const parent = path
    .slice(0, -1)
    .reduce<Record<string | number, unknown>>((node, key) => node[key] as Record<string | number, unknown>, copy);
  const key = path[path.length - 1] as string | number;
  parent[key] = change(parent[key]);
  return copy;
}

/** A way to damage a tree of JSON at some place that the damage itself picks: remove, replace, or turn into something else. */
export function arbDamage(): fc.Arbitrary<(root: Json | null) => unknown> {
  const arbReplacement = fc.anything({ maxDepth: 2, withBigInt: true, withDate: true, withNullPrototype: true });
  return fc
    .record({
      pick: fc.nat(),
      kind: fc.constantFrom('remove', 'replace', 'null', 'wrong type', 'truncate'),
      replacement: arbReplacement,
    })
    .map(({ pick, kind, replacement }) => (root) => {
      const places = pathsOf(root ?? undefined);
      const path = places[pick % places.length] ?? [];
      switch (kind) {
        case 'remove': {
          if (path.length === 0) {
            return undefined;
          }
          const parentPath = path.slice(0, -1);
          const key = path[path.length - 1] as string | number;
          return edit(root ?? undefined, parentPath, (parent) => {
            if (Array.isArray(parent)) {
              return parent.filter((_, index) => index !== key);
            }
            const { [key as string]: _gone, ...rest } = parent as Record<string, unknown>;
            return rest;
          });
        }
        case 'replace':
          return edit(root ?? undefined, path, () => replacement);
        case 'null':
          return edit(root ?? undefined, path, () => null);
        case 'wrong type':
          return edit(root ?? undefined, path, (node) =>
            typeof node === 'string'
              ? 5
              : typeof node === 'number'
                ? String(node)
                : typeof node === 'boolean'
                  ? 0
                  : [node],
          );
        default:
          return edit(root ?? undefined, path, (node) =>
            Array.isArray(node)
              ? node.slice(0, Math.floor(node.length / 2))
              : typeof node === 'string'
                ? node.slice(0, 1)
                : node,
          );
      }
    });
}

/** The keys whose value is the name of something, and the lists that hold names: what a snapshot refers to other things by. */
const NAME_KEYS = new Set(['name', 'id', 'tag', 'queue', 'channel', 'source', 'producer', 'exchange', 'from']);
const NAME_LISTS = new Set(['tags', 'turn', 'blocked']);

/** The keys whose value may be nothing, and so may be nothing where it was something, and something where it was nothing. */
const NULLABLE_KEYS = new Set(['working', 'target', 'processingMs', 'nextTickAt']);

interface Node {
  readonly path: Path;
  readonly value: unknown;
}

const nodesOf = (root: Json): Node[] => pathsOf(root).map((path) => ({ path, value: at(root, path) }));

const lastKey = (path: Path): string | number | undefined => path[path.length - 1];

const isName = ({ path, value }: Node): boolean =>
  typeof value === 'string' &&
  (NAME_KEYS.has(String(lastKey(path))) ||
    NAME_LISTS.has(String(path[path.length - 2])) ||
    // The name of a pair of an exchange and its counters.
    (path[0] === 'exchangeCounters' && path.length === 3 && lastKey(path) === 0));

/**
 * Damage that keeps the types of a tree and changes what it says. It is for data that has been through a schema and so is the right shape, which is the data that a reader behind the schema has to take on trust: a
 * name that is another name, a number that is one more or one less, a flag that is the other, a list with an element gone, twice, swapped or reversed, and a value that is nothing where it was
 * something (and the other way round, for the few that may be).
 */
export function arbTypedDamage(): fc.Arbitrary<(root: Json) => Json> {
  return fc
    .record({
      pick: fc.nat(),
      other: fc.nat(),
      kind: fc.constantFrom(
        'name',
        'name',
        'number',
        'number',
        'flip',
        'remove',
        'remove',
        'duplicate',
        'duplicate',
        'swap',
        'reverse',
        'empty',
        'null',
        'fill',
      ),
      by: fc.constantFrom(-1, 1, 0),
    })
    .map(({ pick, other, kind, by }) => (root) => {
      const nodes = nodesOf(root);
      const of = <T extends Node>(candidates: readonly T[], index: number): T | undefined =>
        candidates.length === 0 ? undefined : candidates[index % candidates.length];
      const set = (path: Path, value: unknown): Json => edit(root, path, () => value) as Json;

      switch (kind) {
        case 'name': {
          const names = nodes.filter(isName);
          const target = of(names, pick);
          const source = of([...names, { path: [], value: 'ghost' }], other);
          return target === undefined || source === undefined ? root : set(target.path, source.value);
        }
        case 'number': {
          const numbers = nodes.filter(({ path, value }) => typeof value === 'number' && lastKey(path) !== 'version');
          const target = of(numbers, pick);
          const source = of(numbers, other);
          if (target === undefined || source === undefined) {
            return root;
          }
          const value = target.value as number;
          return set(target.path, by === 0 ? (source.value as number) : Math.max(0, value + by));
        }
        case 'flip': {
          const target = of(
            nodes.filter(({ value }) => typeof value === 'boolean'),
            pick,
          );
          return target === undefined ? root : set(target.path, !target.value);
        }
        case 'null': {
          const target = of(
            nodes.filter(({ path, value }) => value !== null && NULLABLE_KEYS.has(String(lastKey(path)))),
            pick,
          );
          return target === undefined ? root : set(target.path, null);
        }
        case 'fill': {
          const empty = of(
            nodes.filter(({ path, value }) => value === null && NULLABLE_KEYS.has(String(lastKey(path)))),
            pick,
          );
          if (empty === undefined) {
            return root;
          }
          const key = String(lastKey(empty.path));
          // A number is a time or a duration; a held copy or a target is another one of the same key, or, for a channel, one that it is waiting for.
          if (key === 'processingMs' || key === 'nextTickAt') {
            return set(empty.path, by === 0 ? 0 : 100);
          }
          const same = nodes.filter(({ path, value }) => value !== null && lastKey(path) === key);
          const waiting = nodes.filter(({ path }) => path[path.length - 2] === 'waiting');
          const source = of(same.length > 0 ? same : waiting, other);
          return source === undefined ? root : set(empty.path, structuredClone(source.value));
        }
        default: {
          const lists = nodes.filter(({ value }) => Array.isArray(value));
          const target = of(lists, pick);
          if (target === undefined) {
            return root;
          }
          const list = target.value as Json[];
          const index = list.length === 0 ? 0 : other % list.length;
          switch (kind) {
            case 'remove':
              return set(
                target.path,
                list.filter((_, at) => at !== index),
              );
            case 'duplicate':
              return list.length === 0
                ? root
                : set(target.path, [
                    ...list.slice(0, index + 1),
                    structuredClone(list[index]),
                    ...list.slice(index + 1),
                  ]);
            case 'swap': {
              if (list.length < 2) {
                return root;
              }
              const copy = [...list];
              const to = (index + 1) % list.length;
              [copy[index], copy[to]] = [copy[to] as Json, copy[index] as Json];
              return set(target.path, copy);
            }
            case 'reverse':
              return set(target.path, [...list].reverse());
            default:
              return set(target.path, []);
          }
        }
      }
    });
}
