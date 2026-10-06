import { LiveAnnouncer } from '@angular/cdk/a11y';
import { inject, Injectable, signal } from '@angular/core';

export type Politeness = 'polite' | 'assertive';
export type AnnouncerSink = (message: string, politeness: Politeness) => void;

/**
 * Where the app speaks (ADR-0017, ADR-0031): one live region, so that a screen reader hears the messages of the app and the
 * canvas's own in one place and in order. The editor's code says what it has to say here, and the canvas's adapter puts its
 * own live region in front while it is on the page, so that the messages that the library speaks and the ones that
 * the app speaks are in the same one. Without it, the live region of the CDK is used.
 */
@Injectable({ providedIn: 'root' })
export class Announcer {
  private readonly live = inject(LiveAnnouncer);
  private sink: AnnouncerSink | undefined;
  private readonly latest = signal('');

  /** What was said last, for a screen that wants to show it and for a spec. */
  readonly last = this.latest.asReadonly();

  /** `assertive` interrupts, and is for refusals and for what cannot wait. Everything routine is `polite`. */
  announce(message: string, politeness: Politeness = 'polite'): void {
    this.latest.set(message);
    if (this.sink === undefined) {
      void this.live.announce(message, politeness);
    } else {
      this.sink(message, politeness);
    }
  }

  /** Speaks through `sink` until the function that it returns is called. */
  useSink(sink: AnnouncerSink): () => void {
    this.sink = sink;
    return () => {
      if (this.sink === sink) {
        this.sink = undefined;
      }
    };
  }
}
