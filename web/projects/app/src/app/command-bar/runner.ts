import { inject, Injectable } from '@angular/core';
import { isRuntimeCommand, parseCommand, type Issue } from '@rmq/domain';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { helpOutput, type HelpOutput } from './help';

/** What a line did, for the bar that showed it to say. The bus has already told the learner what it did, on the status line and aloud. */
export type RunOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly issue: Issue }
  | { readonly kind: 'undone' | 'redone'; readonly done: boolean }
  | { readonly kind: 'help'; readonly output: HelpOutput };

/** A line that is accepted and changes nothing leaves nothing to undo, so it has to say that it changed nothing, and why. */
export const NOTHING_CHANGED = 'Nothing changed, because the canvas already is as that command says.';

/**
 * Runs a line of the command bar (ADR-0045): it is read with the parser against the canvas as it is, and applied with the bus as a gesture is, so that it is one step of
 * undo, is saved, said and logged, and a refusal says the root cause first and what the broker answers after it. The only difference from a gesture is the origin.
 * `undo` and `redo` are answered by the bus, and `help` by the registry, which changes nothing. The commands of the simulation go to the bus too, which runs them and says
 * what they did (ADR-0054): one that changed nothing has been told so already, and is not a change of the canvas.
 */
@Injectable()
export class CommandRunner {
  private readonly bus = inject(CommandBus);
  private readonly store = inject(DocumentStore);

  run(line: string): RunOutcome {
    const parsed = parseCommand(line, this.store.document());
    if (!parsed.ok) {
      this.bus.refuse(parsed.error, 'typed');
      return { kind: 'refused', issue: parsed.error };
    }
    const command = parsed.value;
    if (isRuntimeCommand(command)) {
      const result = this.bus.run(command, 'typed');
      return result.ok
        ? { kind: result.value.changed ? 'applied' : 'unchanged' }
        : { kind: 'refused', issue: result.error };
    }
    switch (command.type) {
      case 'undo':
        return { kind: 'undone', done: this.bus.undo('typed') };
      case 'redo':
        return { kind: 'redone', done: this.bus.redo('typed') };
      case 'help':
        return { kind: 'help', output: helpOutput(command.command) };
      default: {
        const before = this.store.document();
        const result = this.bus.apply(command, 'typed');
        if (!result.ok) {
          // The bus has told the refusal already.
          return { kind: 'refused', issue: result.error };
        }
        if (result.value === before) {
          this.bus.say(NOTHING_CHANGED);
          return { kind: 'unchanged' };
        }
        return { kind: 'applied' };
      }
    }
  }
}
