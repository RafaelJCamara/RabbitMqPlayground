import { RABBITMQ_BASELINE } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { COMMAND_DOCS, renderCommandReference, type CommandDoc } from './command-docs';

const bind: CommandDoc = {
  name: 'bind',
  syntax: 'bind <exchange> -> <queue|exchange> [key=…]',
  summary: 'Binds a queue or an exchange to an exchange.',
  examples: ['bind orders -> billing key=order.*', 'bind orders -> audit'],
};
const declare: CommandDoc = {
  name: 'declare',
  syntax: 'declare exchange <name> type=direct|fanout|topic|headers',
  summary: 'Declares an exchange or a queue.',
  examples: [],
};

describe('renderCommandReference', () => {
  it('says so when no commands are registered', () => {
    const text = renderCommandReference([]);

    expect(text).toContain('# Command reference');
    expect(text).toContain('No commands are registered yet');
  });

  it('names the RabbitMQ baseline the commands model', () => {
    expect(renderCommandReference([])).toContain(`They model RabbitMQ ${RABBITMQ_BASELINE}.`);
  });

  it('describes each command with its syntax and examples', () => {
    const text = renderCommandReference([bind]);

    expect(text).toContain('## `bind`');
    expect(text).toContain('Binds a queue or an exchange to an exchange.');
    expect(text).toContain('**Syntax:** `bind <exchange> -> <queue|exchange> [key=…]`');
    expect(text).toContain('```\nbind orders -> billing key=order.*\nbind orders -> audit\n```');
    expect(text).not.toContain('No commands are registered yet');
  });

  it('leaves out the examples block for a command without examples', () => {
    expect(renderCommandReference([declare])).not.toContain('**Examples:**');
  });

  it('lists the commands in name order whatever order they were registered in', () => {
    const text = renderCommandReference([declare, bind]);

    expect(text.indexOf('## `bind`')).toBeLessThan(text.indexOf('## `declare`'));
    expect(renderCommandReference([bind, declare])).toBe(text);
  });

  it('does not change the list it is given', () => {
    const docs = Object.freeze([declare, bind]);

    expect(() => renderCommandReference(docs)).not.toThrow();
    expect(docs.map((doc) => doc.name)).toEqual(['declare', 'bind']);
  });

  it('refuses two commands with the same name', () => {
    expect(() => renderCommandReference([bind, { ...bind, summary: 'Another one.' }])).toThrow(
      'Duplicate command name: bind',
    );
  });

  it('ends with a single newline', () => {
    for (const docs of [[], [bind], [bind, declare]]) {
      const text = renderCommandReference(docs);

      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }
  });
});

describe('COMMAND_DOCS', () => {
  it('can always be rendered, so the registry never has two commands with one name', () => {
    expect(() => renderCommandReference(COMMAND_DOCS)).not.toThrow();
  });
});
