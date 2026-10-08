import type { CanvasDocument } from '@rmq/domain';

/** What a step of the tour asks of the canvas (ADR-0083): the canvas as it is, and how many messages the learner has sent since the tour began. */
export interface TourFacts {
  readonly document: CanvasDocument;
  readonly sent: number;
}

export interface TourStep {
  readonly id: 'add' | 'link' | 'bind' | 'consume' | 'send' | 'finish';
  /** What to do, in a few words. */
  readonly title: string;
  /** Why, and how, in plain words that name what is on the screen. */
  readonly text: string;
  /** Whether the five ways to link are listed under the text. */
  readonly ways: boolean;
  /** Whether the canvas has what the step asks for, and `null` for the last step, which asks for nothing. */
  readonly done: ((facts: TourFacts) => boolean) | null;
}

const count = (record: Readonly<Record<string, unknown>>): number => Object.keys(record).length;

/**
 * The six steps (ADR-0083). A step is a question about the canvas and not about which control was used, so the five ways of linking, which all end at the same command (ADR-0041),
 * are one answer, and so is the command bar.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'add',
    title: 'Add a producer, an exchange and a queue',
    text: 'Click Producer, an exchange and Queue in the toolbox on the left, or drag them onto the canvas. A producer sends messages, an exchange decides where they go, and a queue keeps them until a consumer takes them.',
    ways: false,
    done: ({ document }) =>
      count(document.producers) > 0 && count(document.exchanges) > 0 && count(document.queues) > 0,
  },
  {
    id: 'link',
    title: 'Link the producer to the exchange',
    text: 'A producer publishes to what it is linked to. Use any one of these:',
    ways: true,
    done: ({ document }) => Object.values(document.producers).some((producer) => producer.target?.kind === 'exchange'),
  },
  {
    id: 'bind',
    title: 'Bind the exchange to the queue',
    text: 'A binding tells the exchange which queue wants its messages. Link the exchange to the queue in any of the same ways. If it asks for a key, type one and press Enter.',
    ways: false,
    done: ({ document }) => Object.values(document.bindings).some((binding) => binding.dest.kind === 'queue'),
  },
  {
    id: 'consume',
    title: 'Add a consumer and give it the queue',
    text: 'Add a Consumer from the toolbox, then link the queue to it in any of the same ways. A consumer takes the messages that wait in the queues it consumes from.',
    ways: false,
    done: ({ document }) => Object.values(document.consumers).some((consumer) => consumer.queues.length > 0),
  },
  {
    id: 'send',
    title: 'Send a message',
    text: 'Select the producer and press P, or press Publish now in the inspector. Watch the message go from the producer, through the exchange, to the queue and the consumer.',
    ways: false,
    done: ({ sent }) => sent > 0,
  },
  {
    id: 'finish',
    title: 'That is the whole path',
    text: 'A message goes from a producer through an exchange to a queue, and from the queue to a consumer. Press / to type commands, ? to see every key, and use “New from a template…” on My canvases to see more.',
    ways: false,
    done: null,
  },
];
