import { Component, computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Announcer } from '../core/announcer';
import { FeatureFlags } from '../core/flags/feature-flags';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { BUTTON, BUTTON_PRIMARY } from '../core/ui/buttons';
import { WAYS_TO_LINK } from '../core/ui/ways-to-link';
import { TOUR_STEPS, type TourFacts, type TourStep } from './tour-steps';
import { TourRequests } from './tour-requests';

/**
 * The tour of one editor (ADR-0083): which step it is on, whether that step is done, and what moves it on. It begins when the chooser asked for it (ADR-0082) and this is the editor
 * that opens next, it reads the canvas and the bus and never changes them, and it goes with the editor. Nothing about it is kept.
 */
@Injectable()
export class TourController {
  private readonly store = inject(DocumentStore);
  private readonly bus = inject(CommandBus);
  private readonly announcer = inject(Announcer);

  private readonly running = signal(false);
  private readonly place = signal(0);
  /** Whether the step was done when the tour came to it: such a step waits to be moved on, so that Back does not bounce. */
  private readonly doneOnEntry = signal(false);
  /** How many messages the learner has sent since the tour began. */
  private readonly sent = signal(0);

  readonly count = TOUR_STEPS.length;
  /** Whether the tour is being taken. */
  readonly active = this.running.asReadonly();
  /** The number of the step, from 0. */
  readonly index = this.place.asReadonly();
  readonly step = computed<TourStep>(() => TOUR_STEPS[this.place()] as TourStep);
  readonly last = computed(() => this.place() === TOUR_STEPS.length - 1);
  /** Whether the canvas has what the step asks for. */
  readonly done = computed(() => this.question(this.step()));

  constructor() {
    const flags = inject(FeatureFlags);
    const stop = this.bus.onApplied(({ command }) => {
      if (this.running() && command.type === 'publish') {
        this.sent.update((sent) => sent + 1);
      }
    });
    inject(DestroyRef).onDestroy(stop);
    effect(() => {
      // A step that becomes done while it is the step moves the tour on (ADR-0083).
      const becameDone = this.running() && !this.last() && this.done() && !this.doneOnEntry();
      if (becameDone) {
        untracked(() => this.enter(this.place() + 1));
      }
    });
    if (flags.isEnabled('onboarding') && flags.isEnabled('simulation') && inject(TourRequests).take()) {
      this.begin();
    }
  }

  begin(): void {
    this.sent.set(0);
    this.running.set(true);
    this.enter(0);
  }

  /** Goes on to the next step, whether or not this one is done. */
  next(): void {
    if (this.running() && !this.last()) {
      this.enter(this.place() + 1);
    }
  }

  back(): void {
    if (this.running() && this.place() > 0) {
      this.enter(this.place() - 1);
    }
  }

  /** Ends the tour: the learner pressed End tour or Finish. */
  end(): void {
    if (this.running()) {
      this.running.set(false);
      this.announcer.announce('Tour ended.');
    }
  }

  private enter(index: number): void {
    this.place.set(index);
    this.doneOnEntry.set(this.question(TOUR_STEPS[index] as TourStep));
    const step = TOUR_STEPS[index] as TourStep;
    this.announcer.announce(`Tour, step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}.`);
  }

  private question(step: TourStep): boolean {
    const facts: TourFacts = { document: this.store.document(), sent: this.sent() };
    return step.done !== null && step.done(facts);
  }
}

/**
 * The tour (ADR-0083): a banner under the simulation bar, a region with a name, that says what to do next and is ticked off by the canvas. It covers nothing, takes no focus and traps
 * no key; the card of the first run gives its place to it.
 */
@Component({
  selector: 'rmq-tour',
  template: `
    @if (tour.active()) {
      <section class="border-line bg-panel border-b px-4 py-2 text-sm" aria-label="Tour" data-testid="tour">
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-muted text-xs" data-testid="tour-progress">
              Step {{ tour.index() + 1 }} of {{ tour.count }}
            </p>
            <h2 class="font-semibold" data-testid="tour-title">{{ tour.step().title }}</h2>
            <p data-testid="tour-text">{{ tour.step().text }}</p>
            @if (tour.step().ways) {
              <ol class="mt-1 flex list-decimal flex-col gap-0.5 pl-5" data-testid="tour-ways">
                @for (way of ways; track way) {
                  <li>{{ way }}</li>
                }
              </ol>
            }
            @if (tour.done() && !tour.last()) {
              <p class="mt-1 font-medium" data-testid="tour-done">Done.</p>
            }
          </div>
          <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            @if (tour.index() > 0) {
              <button type="button" [class]="button" data-testid="tour-back" (click)="tour.back()">Back</button>
            }
            @if (tour.last()) {
              <button type="button" [class]="primary" data-testid="tour-finish" (click)="tour.end()">Finish</button>
            } @else {
              <button
                type="button"
                [class]="tour.done() ? primary : button"
                data-testid="tour-next"
                (click)="tour.next()"
              >
                {{ tour.done() ? 'Next' : 'Skip this step' }}
              </button>
              <button type="button" [class]="button" data-testid="tour-end" (click)="tour.end()">End tour</button>
            }
          </div>
        </div>
      </section>
    }
  `,
  host: { class: 'contents' },
})
export class Tour {
  protected readonly tour = inject(TourController);
  protected readonly ways = WAYS_TO_LINK.map((way) => way.short);
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
}
