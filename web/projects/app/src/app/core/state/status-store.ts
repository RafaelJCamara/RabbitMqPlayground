import { computed, Injectable, signal } from '@angular/core';
import type { Issue } from '@rmq/domain';
import type { CommandOrigin } from './origin';

/** The last thing that the learner should be told: something that was done, or something that was refused and why. */
export type Notice =
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'refusal'; readonly issue: Issue; readonly origin: CommandOrigin };

export type Refusal = Extract<Notice, { kind: 'refusal' }>;

/**
 * What the status line shows (ADR-0031). A refusal is an `Issue`, whose message says the root cause first and whose reply of the
 * broker, where there is one, comes after it (ADR-0024). Whoever shows it must show both, in that order.
 */
@Injectable()
export class StatusStore {
  private readonly current = signal<Notice | null>(null);

  readonly notice = this.current.asReadonly();
  readonly refusal = computed<Refusal | null>(() => {
    const notice = this.current();
    return notice?.kind === 'refusal' ? notice : null;
  });

  say(text: string): void {
    this.current.set({ kind: 'message', text });
  }

  refuse(issue: Issue, origin: CommandOrigin): void {
    this.current.set({ kind: 'refusal', issue, origin });
  }

  clear(): void {
    this.current.set(null);
  }

  /** Forgets a refusal that came from this origin, and leaves any other notice alone. */
  clearRefusalFrom(origin: CommandOrigin): void {
    const notice = this.current();
    if (notice?.kind === 'refusal' && notice.origin === origin) {
      this.current.set(null);
    }
  }
}

/** A refusal as a person would hear it: the root cause first, then what the broker answers, if it answers. */
export function speakRefusal(issue: Issue): string {
  return issue.refusal === undefined
    ? issue.message
    : `${issue.message} RabbitMQ would answer ${issue.refusal.code} ${issue.refusal.text}.`;
}
