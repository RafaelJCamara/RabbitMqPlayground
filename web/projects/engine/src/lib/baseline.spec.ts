import { describe, expect, it } from 'vitest';
import { RABBITMQ_BASELINE } from './baseline';

describe('RABBITMQ_BASELINE', () => {
  it('names a major.minor version line, as ADR-0008 records on every canvas', () => {
    expect(RABBITMQ_BASELINE).toMatch(/^\d+\.\d+$/);
  });
});
