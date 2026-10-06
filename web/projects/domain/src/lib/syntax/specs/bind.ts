import type { HeaderArguments, HeaderCondition, HeaderEntry, XMatch } from '@rmq/engine';
import type { BindCommand, UnbindCommand } from '../../commands/types';
import { canonicalHeaders } from '../../document/headers';
import type { OptionSpec } from '../cursor';
import { refText, type CommandSpec } from '../spec';
import { formatCondition } from '../values';
import { wordText } from '../words';

const X_MATCHES: readonly XMatch[] = ['all', 'any', 'all-with-x', 'any-with-x'];

const BINDING_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'key',
    value: { kind: 'text' },
    summary: 'the binding key: the routing key for a direct exchange, a pattern for a topic one',
  },
  {
    name: 'x-match',
    value: { kind: 'enum', values: X_MATCHES },
    summary: 'how the conditions of a headers binding are combined',
  },
];
const OPTION_NAMES = BINDING_OPTIONS.map(({ name }) => name);

const DESTINATIONS = ['queue', 'exchange'] as const;

/** What `bind` and `unbind` read: the two ends, a key, a mode and the conditions. */
function parseBinding(cursor: Parameters<CommandSpec['parse']>[0]) {
  const source = cursor.ref(['exchange'], 'the exchange to bind from').name;
  cursor.arrow();
  const destination = cursor.ref(DESTINATIONS, 'the queue or exchange to bind to');
  const { options, conditions } = cursor.options({ options: BINDING_OPTIONS, conditions: true });
  const headers = canonicalHeaders({ xMatch: (options['x-match'] as XMatch | undefined) ?? null, args: conditions });
  return {
    source,
    destination: { kind: destination.kind as 'queue' | 'exchange', name: destination.name },
    key: (options['key'] as string | undefined) ?? '',
    ...(headers === undefined ? {} : { headers }),
  };
}

function formatBinding(
  verb: string,
  command: { source: string; destination: BindCommand['destination']; key: string; headers?: HeaderArguments },
  document: Parameters<CommandSpec['format']>[1],
): string {
  const headers = canonicalHeaders(command.headers);
  const conditions: readonly HeaderEntry<HeaderCondition>[] = headers?.args ?? [];
  return [
    verb,
    wordText(command.source),
    '->',
    refText(document, command.destination, DESTINATIONS),
    ...(command.key === '' ? [] : [`key=${wordText(command.key)}`]),
    ...(headers?.xMatch == null ? [] : [`x-match=${headers.xMatch}`]),
    ...conditions.map(({ key, value }) => formatCondition(key, value, OPTION_NAMES)),
  ].join(' ');
}

const SYNTAX =
  '<exchange> -> <queue|exchange> [key=<text>] [x-match=all|any|all-with-x|any-with-x] [<header>=<value> | exists(<header>)]...';

export const bind: CommandSpec<BindCommand> = {
  name: 'bind',
  type: 'bind',
  scope: 'document',
  syntax: `bind ${SYNTAX}`,
  summary:
    'Binds a queue or an exchange to an exchange. The key matters to a direct exchange and to a topic exchange, and the conditions to a headers exchange: a value written as `1` is an integer, as `1.0` a float, as `true` a boolean and as `"1"` a string, and `exists(name)` asks only for the header to be there. Binding what is bound changes nothing.',
  examples: [
    'bind orders -> archive key=order.#',
    'bind docs -> billing x-match=all format=pdf size=10 exists(author)',
  ],
  parse: (cursor) => ({ type: 'bind', ...parseBinding(cursor) }),
  format: (command, document) => formatBinding('bind', command, document),
};

export const unbind: CommandSpec<UnbindCommand> = {
  name: 'unbind',
  type: 'unbind',
  scope: 'document',
  syntax: `unbind ${SYNTAX}`,
  summary: 'Takes a binding off, the one with exactly this key and these conditions.',
  examples: ['unbind orders -> billing key=order.*'],
  parse: (cursor) => ({ type: 'unbind', ...parseBinding(cursor) }),
  format: (command, document) => formatBinding('unbind', command, document),
};
