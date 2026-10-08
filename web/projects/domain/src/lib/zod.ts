import { z } from 'zod';

/**
 * zod, with its parsers not compiled by `new Function` (ADR-0078). It tries once, to see whether it may, and when the page has a content security policy without `'unsafe-eval'` the browser refuses, which zod expects and
 * handles, and says so all the same: in the console, and to the listener of the policy, as a violation that is not one. The schemas of a document are strict objects, which zod does not compile in any case, so nothing is
 * slower for it: a canvas of 200 nodes and 500 edges is read in a third of a millisecond either way. Every schema of the domain is made from this `z`, so that the setting is made before the first one is.
 */
z.config({ jitless: true });

export { z };
