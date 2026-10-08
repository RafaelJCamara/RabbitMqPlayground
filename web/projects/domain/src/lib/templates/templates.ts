/**
 * The templates (S11, ADR-0081): six canvases that teach one thing each, written as scripts of the command language, one command to a line, exactly as the command bar takes them. A script is
 * the canvas and the way to make it in one: it is read by the parser and applied by the commands like anything a learner types, so it cannot say what a canvas cannot hold, and the lessons
 * of M5 can run the same lines. They are the tutorials of RabbitMQ, put on a canvas, and each opens as a canvas of its own.
 */

/** What a template is called to the code. */
export type TemplateId = 'hello-world' | 'work-queues' | 'pub-sub' | 'routing' | 'topics' | 'headers';

export interface Template {
  readonly id: TemplateId;
  /** The name on its card, and of the canvas that it makes. */
  readonly name: string;
  /** What it shows, in a sentence. */
  readonly summary: string;
  /** What to do when it is open, in a sentence or two. */
  readonly tryThis: string;
  /** The commands that make it, one to a line, in the form that the command log writes them. */
  readonly script: readonly string[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'hello-world',
    name: 'Hello World',
    summary: 'A producer, a queue and a consumer: the smallest thing that sends a message.',
    tryThis:
      'Select the producer and press P to send a message. It goes to the queue through the default exchange, and the consumer takes it.',
    script: [
      'declare queue hello',
      'add producer sender',
      'link sender -> hello',
      'set sender payload="Hello World!"',
      'add consumer receiver',
      'subscribe receiver hello',
      'layout',
    ],
  },
  {
    id: 'work-queues',
    name: 'Work Queues',
    summary:
      'Two consumers share the tasks of one queue. Each takes one task at a time, so the faster one takes more of them.',
    tryThis:
      'Select the producer and press P: it sends six tasks. Watch which consumer takes each one, and change the processing time of a consumer in the inspector.',
    script: [
      'declare queue tasks',
      'add producer dispatcher',
      'link dispatcher -> tasks',
      'set dispatcher payload="A task" burst=6',
      'add consumer slow-worker',
      'subscribe slow-worker tasks',
      'set slow-worker ack=manual prefetch=1 processing=1500',
      'add consumer fast-worker',
      'subscribe fast-worker tasks',
      'set fast-worker ack=manual prefetch=1 processing=500',
      'layout',
    ],
  },
  {
    id: 'pub-sub',
    name: 'Pub/Sub',
    summary: 'A fanout exchange copies every message to every queue that is bound to it.',
    tryThis:
      'Select the producer and press P. The one message arrives in both queues, and each consumer gets a copy of its own.',
    script: [
      'declare exchange logs type=fanout',
      'declare queue to-file',
      'declare queue to-screen',
      'bind logs -> to-file',
      'bind logs -> to-screen',
      'add producer emitter',
      'link emitter -> logs',
      'set emitter payload="Something happened"',
      'add consumer file-logger',
      'subscribe file-logger to-file',
      'add consumer screen-logger',
      'subscribe screen-logger to-screen',
      'layout',
    ],
  },
  {
    id: 'routing',
    name: 'Routing',
    summary: 'A direct exchange sends a message only to the queues that are bound with its exact key.',
    tryThis:
      'Press P on each producer. The error goes to both queues, because both are bound with the key error. The info goes only to the queue of everything.',
    script: [
      'declare exchange direct_logs type=direct',
      'declare queue errors',
      'declare queue everything',
      'bind direct_logs -> errors key=error',
      'bind direct_logs -> everything key=info',
      'bind direct_logs -> everything key=warning',
      'bind direct_logs -> everything key=error',
      'add producer app-errors',
      'link app-errors -> direct_logs',
      'set app-errors payload="Disk is full" key=error',
      'add producer app-info',
      'link app-info -> direct_logs',
      'set app-info payload=Started key=info',
      'add consumer pager',
      'subscribe pager errors',
      'add consumer archiver',
      'subscribe archiver everything',
      'layout',
    ],
  },
  {
    id: 'topics',
    name: 'Topics',
    summary:
      'A topic exchange matches the words of a key against patterns: * stands for one word and # for any number of them.',
    tryThis:
      'Press P on the producer: quick.orange.rabbit matches both queues. Change its key in the inspector to lazy.pink.fox, which matches one, or to quick.brown.fox, which matches none.',
    script: [
      'declare exchange topic_logs type=topic',
      'declare queue orange',
      'declare queue rabbits',
      'bind topic_logs -> orange key=*.orange.*',
      'bind topic_logs -> rabbits key=*.*.rabbit',
      'bind topic_logs -> rabbits key=lazy.#',
      'add producer zoo',
      'link zoo -> topic_logs',
      'set zoo payload="A sighting" key=quick.orange.rabbit',
      'add consumer orange-watcher',
      'subscribe orange-watcher orange',
      'add consumer rabbit-watcher',
      'subscribe rabbit-watcher rabbits',
      'layout',
    ],
  },
  {
    id: 'headers',
    name: 'Headers routing',
    summary:
      'A headers exchange ignores the key and matches the headers of the message against the conditions of each binding: all of them, or any one.',
    tryThis:
      'Press P on the scanner: its message has format=pdf, type=report and urgent=true, so it matches both bindings. Take the header urgent off the producer, and only the first queue gets it.',
    script: [
      'declare exchange documents type=headers',
      'declare queue pdf-reports',
      'declare queue flagged',
      'bind documents -> pdf-reports x-match=all format=pdf type=report',
      'bind documents -> flagged x-match=any urgent=true signed=true',
      'add producer scanner',
      'link scanner -> documents',
      'set scanner payload="Quarterly report" header:format=pdf header:type=report header:urgent=true',
      'add consumer reader',
      'subscribe reader pdf-reports',
      'add consumer clerk',
      'subscribe clerk flagged',
      'layout',
    ],
  },
];

/** The template with this id, or `undefined` for a name that is none of them. */
export const templateById = (id: string): Template | undefined => TEMPLATES.find((template) => template.id === id);
