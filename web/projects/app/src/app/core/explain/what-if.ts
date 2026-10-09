import { computed, inject, Injectable, signal } from '@angular/core';
import {
  explainRoute,
  kindOf,
  nameOf,
  outlookOf,
  parseMessageText,
  toTopology,
  wordText,
  type CanvasDocument,
  type Issue,
  type RouteExplanation,
} from '@rmq/domain';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import type { Emphasis } from './emphasis';
import { emphasisOfRoute } from './highlight';

/**
 * The what-if tester (ADR-0064): where a message would go on the canvas as it is, asked of an exchange and a message written as it follows the exchange in `publish`. It reads the canvas and nothing else: it does not publish,
 * does not call the bus or the engine, writes nothing to either log and changes neither the document, the selection nor the history. What it says is worked out again for each change of the text, of the exchange and of the
 * canvas, with no timer, because the work is a few microseconds. It also offers the line that would send the message for real.
 */

/** An exchange that the tester can ask about. The default exchange has no name, and a canvas may not be showing it. */
export interface WhatIfExchange {
  /** The name that the engine knows it by: `''` for the default exchange. */
  readonly name: string;
  readonly label: string;
}

/** What the tester says of the message that is written. */
export interface WhatIfAnswer {
  readonly explanation: RouteExplanation;
  /** The answer first, in the conditional: `Would reach billing and audit.` */
  readonly outlook: string;
  /** The line that would send it for real, as text, or `null` when there is none: the default exchange is not one that a command names, and the simulation is off. */
  readonly line: string | null;
  /** The canvas that it was asked of, which the marks are made from. */
  readonly document: CanvasDocument;
}

/** What it lights while it is open and the message can be read: a title, the answer and the marks. */
export interface WhatIfLit {
  readonly title: string;
  readonly text: string;
  readonly emphasis: Emphasis;
}

@Injectable()
export class WhatIf {
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);

  private readonly opened = signal(false);
  private readonly asked = signal<string | null>(null);
  private readonly typed = signal('');

  readonly isOpen = this.opened.asReadonly();
  /** The message as the learner wrote it. */
  readonly text = this.typed.asReadonly();

  /** The exchanges of the canvas, in the order that it has them, and the default exchange, which every canvas has. */
  readonly exchanges = computed<readonly WhatIfExchange[]>(() => [
    ...Object.values(this.store.document().exchanges).map(({ name, type }) => ({ name, label: `${name} (${type})` })),
    { name: '', label: 'The default exchange' },
  ]);

  /** The exchange that is asked about: the one that was chosen while it is on the canvas, and else the first of them. */
  readonly exchange = computed<string>(() => {
    const list = this.exchanges();
    const asked = this.asked();
    return asked !== null && list.some(({ name }) => name === asked) ? asked : (list[0] as WhatIfExchange).name;
  });

  private readonly message = computed(() => parseMessageText(this.typed()));

  /** Why the message cannot be read, in the words of the grammar, or `null` when it can. */
  readonly issue = computed<Issue | null>(() => {
    const message = this.message();
    return message.ok ? null : message.error;
  });

  /** What the canvas would do with the message, or `null` while the tester is shut or the message cannot be read. */
  readonly answer = computed<WhatIfAnswer | null>(() => {
    const message = this.message();
    if (!this.opened() || !message.ok) {
      return null;
    }
    const document = this.store.document();
    const exchange = this.exchange();
    const explanation = explainRoute(toTopology(document), {
      exchange,
      key: message.value.key,
      headers: message.value.headers,
    });
    const text = this.typed().trim();
    return {
      explanation,
      outlook: outlookOf(explanation),
      line: exchange !== '' ? `publish ${wordText(exchange)}${text === '' ? '' : ` ${text}`}` : null,
      document,
    };
  });

  /** What is lit on the canvas and said in the card, for as long as the tester is open and the message can be read. */
  readonly lit = computed<WhatIfLit | null>(() => {
    const answer = this.answer();
    if (answer === null) {
      return null;
    }
    const { key } = answer.explanation.message;
    const exchange = this.exchange();
    return {
      title: `What if? To ${exchange === '' ? 'the default exchange' : exchange} with ${key === '' ? 'the empty key' : `the key ${JSON.stringify(key)}`}`,
      text: answer.outlook,
      emphasis: emphasisOfRoute(answer.explanation, null, answer.document, answer.document),
    };
  });

  /** Opens the tester. An exchange that is selected is the one that it asks about. */
  open(): void {
    const only = this.selection.only();
    const document = this.store.document();
    if (only?.kind === 'node' && kindOf(document, only.id) === 'exchange') {
      this.asked.set(nameOf(document, 'exchange', only.id) ?? null);
    }
    this.opened.set(true);
  }

  close(): void {
    this.opened.set(false);
  }

  toggle(): boolean {
    if (this.opened()) {
      this.close();
    } else {
      this.open();
    }
    return this.opened();
  }

  choose(exchange: string): void {
    this.asked.set(exchange);
  }

  type(text: string): void {
    this.typed.set(text);
  }
}
