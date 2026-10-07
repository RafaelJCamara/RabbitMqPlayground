import { Component, computed, inject } from '@angular/core';
import { SPEEDS, type RuntimeCommand } from '@rmq/domain';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { Icon } from '../core/ui/icon';

const BUTTON =
  'border-border bg-surface hover:bg-canvas disabled:text-muted flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60';
const SPEED_BUTTON =
  'border-border bg-surface hover:bg-canvas aria-pressed:bg-fg aria-pressed:text-surface min-h-8 min-w-10 rounded-md border px-2 py-1 tabular-nums';

/**
 * The strip of the simulation (ADR-0056, ADR-0057): a row under the top bar, so that the bar that S5 made to fit is left as it is and the canvas has the same height
 * before and after the first message. It is a region of the page with a name, and not a toolbar, which would promise arrow keys that it does not have. Each button is a
 * command of the runtime, which it hands to the bus with the origin `toolbar`, as every way of doing it does (ADR-0054). A button says what it does in words, and a key
 * where it has one; the readout at the right is text, and not a live region, because it changes ten times a second.
 */
@Component({
  selector: 'rmq-simulation-bar',
  imports: [Icon],
  template: `
    <section
      class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-1.5 text-sm"
      aria-label="Simulation"
      data-testid="simulation-bar"
    >
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          [class]="button"
          [attr.title]="(simulation.running() ? 'Pause' : 'Play') + ' (' + playKeys + ')'"
          aria-keyshortcuts="Space"
          data-testid="play-pause"
          (click)="run(simulation.running() ? PAUSE : PLAY)"
        >
          <rmq-icon [name]="simulation.running() ? 'pause' : 'play'" [size]="18" />
          <span>{{ simulation.running() ? 'Pause' : 'Play' }}</span>
        </button>
        <button
          type="button"
          [class]="button"
          [disabled]="!simulation.canStep()"
          [attr.title]="
            simulation.canStep()
              ? 'Step to the next event (' + stepKeys + ')'
              : 'Nothing is scheduled, so there is nothing to step to'
          "
          aria-keyshortcuts="."
          data-testid="step"
          (click)="run(STEP)"
        >
          <rmq-icon name="step" [size]="18" />
          <span>Step</span>
        </button>
      </div>
      <div class="flex items-center gap-1" role="group" aria-label="Speed">
        @for (factor of speeds; track factor) {
          <button
            type="button"
            [class]="speedButton"
            [attr.aria-pressed]="simulation.speed() === factor"
            [attr.data-testid]="'speed-' + factor"
            (click)="run({ type: 'speed', factor })"
          >
            {{ factor }}×
          </button>
        }
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" [class]="button" data-testid="clear-messages" (click)="run(CLEAR)">
          <rmq-icon name="trash" [size]="18" />
          <span>Clear messages</span>
        </button>
        <button type="button" [class]="button" data-testid="reset-counters" (click)="run(RESET)">
          <rmq-icon name="reset" [size]="18" />
          <span>Reset counters</span>
        </button>
      </div>
      <p class="text-muted ml-auto flex items-center gap-4 tabular-nums" data-testid="simulation-readout">
        <span>Time {{ seconds() }} s</span>
        <span>{{ onTheWay() }}</span>
      </p>
    </section>
  `,
})
export class SimulationBar {
  protected readonly simulation = inject(Simulation);
  private readonly bus = inject(CommandBus);

  protected readonly button = BUTTON;
  protected readonly speedButton = SPEED_BUTTON;
  protected readonly speeds = SPEEDS;
  protected readonly playKeys = 'Space';
  protected readonly stepKeys = '.';

  protected readonly PLAY: RuntimeCommand = { type: 'play' };
  protected readonly PAUSE: RuntimeCommand = { type: 'pause' };
  protected readonly STEP: RuntimeCommand = { type: 'step' };
  protected readonly CLEAR: RuntimeCommand = { type: 'clear-messages' };
  protected readonly RESET: RuntimeCommand = { type: 'reset-counters' };

  protected readonly seconds = computed(() => (this.simulation.time() / 1000).toFixed(1));
  protected readonly onTheWay = computed(() => {
    const count = this.simulation.travelling();
    return count === 0
      ? 'No messages on their way'
      : count === 1
        ? '1 message on its way'
        : `${count} messages on their way`;
  });

  protected run(command: RuntimeCommand): void {
    this.bus.run(command, 'toolbar');
  }
}
