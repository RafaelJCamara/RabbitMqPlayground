import type { EngineEvent } from '@rmq/engine';
import type { IconName } from '../ui/icons';

/**
 * The families of what the log says (ADR-0061): what a filter is made of, and what gives a row its colour and its mark. The colour is the token of what the family is about (a producer, an
 * exchange, a queue, a consumer, a problem), the mark is an icon of its own, and the name of the event is in the row as a word, so that colour is never the only sign (ADR-0032).
 */

export type Family =
  'commands' | 'publishing' | 'routing' | 'problems' | 'queues' | 'delivery' | 'consumers' | 'simulation';

export interface FamilyInfo {
  readonly id: Family;
  readonly label: string;
  /** The custom property that holds its colour, which is a pair for the light and the dark theme. */
  readonly token: string;
  readonly icon: IconName;
}

export const FAMILIES: readonly FamilyInfo[] = [
  { id: 'commands', label: 'Commands', token: '--rmq-accent', icon: 'command' },
  { id: 'publishing', label: 'Publishing', token: '--rmq-producer', icon: 'send' },
  { id: 'routing', label: 'Routing', token: '--rmq-exchange', icon: 'exchange' },
  { id: 'problems', label: 'Problems', token: '--rmq-danger', icon: 'alert' },
  { id: 'queues', label: 'Queues', token: '--rmq-queue', icon: 'queue' },
  { id: 'delivery', label: 'Delivery', token: '--rmq-consumer', icon: 'consumer' },
  { id: 'consumers', label: 'Consumers', token: '--rmq-warning', icon: 'close' },
  { id: 'simulation', label: 'Simulation', token: '--rmq-muted', icon: 'reset' },
];

export const FAMILY_IDS: readonly Family[] = FAMILIES.map(({ id }) => id);

const BY_TYPE: Readonly<Record<EngineEvent['type'], Family>> = {
  published: 'publishing',
  routed: 'routing',
  unroutable: 'problems',
  refused: 'problems',
  dropped: 'problems',
  enqueued: 'queues',
  'queue.purged': 'queues',
  'queue.deleted': 'queues',
  delivered: 'delivery',
  received: 'delivery',
  processed: 'delivery',
  acked: 'delivery',
  requeued: 'delivery',
  'consumer.cancelled': 'consumers',
  'channel.closed': 'consumers',
  cleared: 'simulation',
  'counters.reset': 'simulation',
};

/** The family of an event. */
export const familyOf = (type: EngineEvent['type']): Family => BY_TYPE[type];

/** The information of a family: its label, its colour and its mark. */
export const infoOf = (family: Family): FamilyInfo => FAMILIES.find(({ id }) => id === family) as FamilyInfo;
