import { Component, computed, input } from '@angular/core';
import { testTopicKey, type TopicSample } from '@rmq/domain';
import { Icon } from '../core/ui/icon';

let nextTester = 0;

/**
 * The inline topic tester (ADR-0064): under the field where a topic binding key is typed, the keys that it matches and the keys that it does not, each with a few words that say how, and a note where a sample shows what
 * surprises. It takes the text as it is typed and works it out at once, with no timer, since the work is a few microseconds. A text that cannot be a binding key says why, in the words of the binding's own check, and has no
 * samples. It decides nothing and says nothing aloud: it is read where it is, after the field.
 */
@Component({
  selector: 'rmq-topic-tester',
  imports: [Icon],
  template: `
    <div
      class="border-line flex flex-col gap-2 rounded-md border p-2 text-xs"
      role="group"
      data-testid="topic-tester"
      aria-label="What this key matches"
    >
      @if (pattern() === '') {
        <p class="text-muted" data-testid="topic-tester-empty">Type a key to see which keys it matches.</p>
      } @else if (refusal(); as why) {
        <p class="text-danger" data-testid="topic-tester-refusal">{{ why }}</p>
      } @else {
        <p class="font-medium" [id]="matchingId">Matches</p>
        <ul class="flex flex-col gap-1" data-testid="topic-matching" [attr.aria-labelledby]="matchingId">
          @for (sample of matching(); track sample.key) {
            <li class="flex flex-col gap-0.5" data-testid="topic-sample">
              <span class="flex flex-wrap items-baseline gap-x-1.5">
                <rmq-icon class="self-center" name="check" [size]="12" style="color: var(--rmq-explain-hit)" />
                <code class="font-mono break-all">{{ show(sample.key) }}</code
                >&ngsp;
                <span class="text-muted">{{ sample.short }}</span>
              </span>
              &ngsp;
              @if (sample.note; as note) {
                <span class="text-muted" data-testid="topic-note">{{ note }}</span>
              }
            </li>
          }
        </ul>
        <p class="font-medium" [id]="missingId">Does not match</p>
        <ul class="flex flex-col gap-1" data-testid="topic-missing" [attr.aria-labelledby]="missingId">
          @for (sample of missing(); track sample.key) {
            <li data-testid="topic-sample">
              <span class="flex flex-wrap items-baseline gap-x-1.5">
                <rmq-icon class="self-center" name="close" [size]="12" style="color: var(--rmq-explain-miss)" />
                <code class="font-mono break-all">{{ show(sample.key) }}</code
                >&ngsp;
                <span class="text-muted">{{ sample.short }}</span>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class TopicTester {
  /** The binding key as it is typed. */
  readonly pattern = input.required<string>();

  private readonly uid = `rmq-topic-tester-${nextTester++}`;
  protected readonly matchingId = `${this.uid}-matching`;
  protected readonly missingId = `${this.uid}-missing`;

  private readonly tried = computed(() => testTopicKey(this.pattern()));
  /** Why the text cannot be a binding key, or `null` when it can. */
  protected readonly refusal = computed(() => {
    const tried = this.tried();
    return tried.ok ? null : tried.text;
  });
  protected readonly matching = computed<readonly TopicSample[]>(() => {
    const tried = this.tried();
    return tried.ok ? tried.matching : [];
  });
  protected readonly missing = computed<readonly TopicSample[]>(() => {
    const tried = this.tried();
    return tried.ok ? tried.nonMatching : [];
  });

  /** A key as it is shown: the empty key is two quotes, so that it is seen. */
  protected show(key: string): string {
    return key === '' ? '""' : key;
  }
}
