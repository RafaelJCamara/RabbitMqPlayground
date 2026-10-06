import { emptyDocument } from '@rmq/domain';
import { idSequence, manualClock, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './repositories';

describe('createMemoryRepository', () => {
  const options = () => ({ now: manualClock().now, newId: idSequence('m') });

  it('is a repository that keeps canvases in memory, made with the clock and the ids that it is given', async () => {
    const repository = createMemoryRepository(options());
    const made = await repository.create({ name: 'Orders', document: sampleDocument() });

    expect(made).toMatchObject({ ok: true, value: { id: 'm1', name: 'Orders', createdAt: 1_000_000 } });
    expect(await repository.get('m1')).toEqual(made);
  });

  it('is a repository of its own for each, so that two of them do not share what they keep', async () => {
    const [one, other] = [createMemoryRepository(options()), createMemoryRepository(options())];
    await one.create({ name: 'n', document: emptyDocument() });

    expect(await other.list()).toEqual({ ok: true, value: { canvases: [], unreadable: [] } });
  });
});
