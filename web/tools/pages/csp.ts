import { createHash } from 'node:crypto';

/**
 * The content security policy of a built page (ADR-0078). A shared canvas is made of what a stranger wrote, and the page shows it as text; the policy is the second wall, for the day that a name is shown in a way that
 * runs: no script that is not from the page's own files or among the inline scripts that the build made, no `eval`, no plug-in, nothing loaded from another origin.
 *
 * It is a `<meta>` and not a header because GitHub Pages sends no headers of its own, and it is made from the built page and not written in `src/index.html` because `ng serve` needs inline scripts that the
 * policy would refuse, and because the hash of an inline script cannot be known before the build has made it. A policy in a `<meta>` cannot say `frame-ancestors`, `report-uri` or `sandbox`, and applies from the
 * point in the page where it is read, so it is put first.
 */

/** What the page of a build is allowed to do, by directive. `script-src` is given the hashes of the page's inline scripts. */
function directives(scriptHashes: readonly string[]): readonly (readonly [string, readonly string[]])[] {
  return [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...scriptHashes]],
    // The components of Angular put their styles in <style> elements, and a policy in a <meta> cannot carry the nonce of a request.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
}

/** An element of the page that has the text of a script in it. */
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
/** A policy that the page has already, with the space that was put before it, so that making the page again makes the same page. */
const POLICY_META = /\s*<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi;
const CHARSET_META = /<meta\b[^>]*\bcharset\b[^>]*>/i;
const HEAD = /<head\b[^>]*>/i;
/** An attribute that runs code that is in the page: `onload="…"`. Only the name is looked for, in a tag. */
const EVENT_HANDLER = /<[a-z][^>]*?\s(on[a-z]+)\s*=/i;
const SCRIPT_URL = /<[a-z][^>]*?\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i;
/** A script or a style sheet that is somewhere else: `//host/file.js` or `https://host/file.js`. */
const ANOTHER_ORIGIN = /<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["']?\s*((?:https?:)?\/\/[^\s"'>]*)/i;

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
    .exec(attributes)
    ?.slice(1)
    .find(Boolean);

/** The types of an inline script that is data and not code, which no policy has to account for. */
const DATA_TYPES = new Set(['application/json', 'application/ld+json']);
/** The types of an inline script that runs, and that a hash lets run. */
const CODE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

const STYLE = /<style\b([^>]*)>[\s\S]*?<\/style>/gi;

/** The page without the text of its scripts and its styles, which are not markup: what is looked at for handlers and addresses is the tags. */
const markupOf = (html: string): string =>
  html
    .replace(SCRIPT, (_, attributes: string) => `<script${attributes}></script>`)
    .replace(STYLE, (_, attributes: string) => `<style${attributes}></style>`);

/** The text of a script as the browser has it: its line ends are `\n`, which the parser makes of `\r\n` and `\r`, and the hash is of that text. */
const textOf = (script: string): string => script.replace(/\r\n?/g, '\n');

const hashOf = (script: string): string =>
  `'sha256-${createHash('sha256').update(textOf(script), 'utf8').digest('base64')}'`;

/**
 * The hashes of the inline scripts of a page, once each and in the order of the page. It refuses what the policy would break the page with, saying what and where: an inline event handler or a `javascript:` URL
 * (the policy has no `'unsafe-inline'` for scripts, so these would be refused in the browser and the page would not work), an inline script of a type that it cannot hash, and a script or a style sheet from another origin.
 */
export function inlineScriptHashes(html: string): string[] {
  const markup = markupOf(html);
  const handler = EVENT_HANDLER.exec(markup);
  if (handler !== null) {
    throw new Error(
      `The page has an inline event handler (${handler[1]}), which the content security policy refuses to run, because it has no 'unsafe-inline' for scripts. Move it into a script file.`,
    );
  }
  if (SCRIPT_URL.test(markup)) {
    throw new Error(
      "The page has a javascript: URL, which the content security policy refuses to run, because it has no 'unsafe-inline' for scripts.",
    );
  }
  const elsewhere = ANOTHER_ORIGIN.exec(markup);
  if (elsewhere !== null) {
    throw new Error(
      `The page loads ${elsewhere[1]}, which is from another origin, and the content security policy allows only the page's own files. Put the file in the build.`,
    );
  }
  const hashes = new Set<string>();
  for (const [, attributes = '', text = ''] of html.matchAll(SCRIPT)) {
    if (attribute(attributes, 'src') !== undefined) {
      continue;
    }
    const type = (attribute(attributes, 'type') ?? '').toLowerCase();
    if (DATA_TYPES.has(type)) {
      continue;
    }
    if (!CODE_TYPES.has(type)) {
      throw new Error(
        `The page has an inline script of type "${type}", which the content security policy cannot account for. Only scripts that run as classic or module scripts are given a hash.`,
      );
    }
    hashes.add(hashOf(text));
  }
  return [...hashes];
}

/** The policy of a page, as the text of a `Content-Security-Policy`. */
export function contentSecurityPolicy(html: string): string {
  return directives(inlineScriptHashes(html))
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

const escaped = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The page with its policy, in a `<meta>` right after the character set, or at the start of the head when there is none to follow. A policy that the page had is replaced, so that making the page
 * twice makes the same page.
 */
export function withContentSecurityPolicy(html: string): string {
  const page = html.replace(POLICY_META, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escaped(contentSecurityPolicy(page))}">`;
  const charset = CHARSET_META.exec(page);
  const head = HEAD.exec(page);
  const after = charset ?? head;
  if (after === null) {
    throw new Error(
      'The page has no <head>, so there is nowhere to put the content security policy before any script.',
    );
  }
  const at = after.index + after[0].length;
  return `${page.slice(0, at)}${charset === null ? '' : '\n    '}${meta}${page.slice(at)}`;
}
