import { describe, expect, it } from 'vitest';
import { canvasDocumentSchema, emptyDocument } from './document/schema';
import { readSnapshot } from './snapshot';
import { z } from './zod';

/** The page of a build has a content security policy that does not allow `eval` (ADR-0078), so zod must not try it. */
describe('zod in the domain', () => {
  it('does not compile its parsers with new Function, which a content security policy refuses and reports', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('is the zod that the schemas of the document and of a snapshot are made from, and they read as they did', () => {
    expect(canvasDocumentSchema.safeParse(emptyDocument()).success).toBe(true);
    expect(canvasDocumentSchema.safeParse({ ...emptyDocument(), extra: 1 }).success).toBe(false);
    expect(readSnapshot({}).ok).toBe(false);
  });
});
