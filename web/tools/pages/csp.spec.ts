import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes, withContentSecurityPolicy } from './csp';

/**
 * The content security policy of a built page (ADR-0078). The hashes in these specs were made by `openssl dgst -sha256 -binary | base64`, and not by the code that is being held to them.
 */

/** The hash of `alert(1)`. */
const ALERT = "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='";
/** The hash of the script that the build puts at the end of the page to turn a style sheet on. */
const BEASTIES = "'sha256-LMY6wYoFV9I4wWzxaq1N/dTpl4iurQktw706UCHK3vM='";
/** The hash of `a` and `b` with a line end between them. */
const TWO_LINES = "'sha256-fhj3NzEbLcOy8mndeDlrA1HxT7Zu+oefdoyyMYGIPHg='";

const BEASTIES_SCRIPT =
  "document.querySelectorAll('link[data-beasties-media]').forEach(function(l){l.media=l.getAttribute('data-beasties-media');l.removeAttribute('data-beasties-media')})";

/** A page as the build makes it: a character set, a base, critical styles, a sheet that is turned on by a script, and the script of the application. */
const page = (body = '', head = ''): string =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <title>RabbitMQ Playground</title>',
    '    <base href="/RabbitMqPlayground/">',
    `${head}  <style>.a>.b{color:red}</style><link rel="stylesheet" href="styles-AAAA.css" media="print" data-beasties-media="all"></head>`,
    '  <body>',
    '    <rmq-root></rmq-root>',
    `  <script src="main-BBBB.js" type="module"></script>${body}</body>`,
    '</html>',
    '',
  ].join('\n');

/** The sources of a directive of a policy. */
const sources = (policy: string, directive: string): string[] =>
  (policy.split('; ').find((item) => item.startsWith(`${directive} `)) ?? '').split(' ').slice(1);

describe('inlineScriptHashes', () => {
  it('has none when the scripts of the page are all files', () => {
    expect(inlineScriptHashes(page())).toEqual([]);
  });

  it('is the sha256 of the text of each inline script, in base64, in single quotes', () => {
    expect(inlineScriptHashes(page('<script>alert(1)</script>'))).toEqual([ALERT]);
    expect(inlineScriptHashes(page(`<script>${BEASTIES_SCRIPT}</script>`))).toEqual([BEASTIES]);
  });

  it('is of the text exactly as it is: a space or a line end more is another hash', () => {
    const [plain] = inlineScriptHashes(page('<script>alert(1)</script>'));
    const [spaced] = inlineScriptHashes(page('<script>alert(1) </script>'));

    expect(plain).toBe(ALERT);
    expect(spaced).not.toBe(ALERT);
  });

  it('is of the text as the browser has it, in which a line end is one character, however the file writes it', () => {
    expect(inlineScriptHashes(page('<script>a\r\nb</script>'))).toEqual([TWO_LINES]);
    expect(inlineScriptHashes(page('<script>a\rb</script>'))).toEqual([TWO_LINES]);
    expect(inlineScriptHashes(page('<script>a\nb</script>'))).toEqual([TWO_LINES]);
  });

  it('is in the order of the page, and has a script once however often it is written', () => {
    const hashes = inlineScriptHashes(
      page('<script>alert(1)</script><script>a\nb</script><script type="module">alert(1)</script>'),
    );

    expect(hashes).toEqual([ALERT, TWO_LINES]);
  });

  it('leaves out a script that is a file, even if it has text in it, which the browser does not run', () => {
    expect(inlineScriptHashes(page('<script src="other.js">alert(1)</script>'))).toEqual([]);
  });

  it('counts a module script, and a script of the types that mean JavaScript, whatever the case', () => {
    expect(inlineScriptHashes(page('<script type="module">alert(1)</script>'))).toEqual([ALERT]);
    expect(inlineScriptHashes(page('<script type="text/javascript">alert(1)</script>'))).toEqual([ALERT]);
    expect(inlineScriptHashes(page('<SCRIPT TYPE="Module">alert(1)</SCRIPT>'))).toEqual([ALERT]);
  });

  it('leaves out a script that is data: the browser does not run it', () => {
    expect(inlineScriptHashes(page('<script type="application/json" id="ng-state">{"a":1}</script>'))).toEqual([]);
    expect(inlineScriptHashes(page('<script type="application/ld+json">{}</script>'))).toEqual([]);
  });

  it('refuses a script of a type that it cannot account for, and says which', () => {
    expect(() => inlineScriptHashes(page('<script type="importmap">{}</script>'))).toThrow(
      /inline script of type "importmap".*cannot account for/,
    );
  });

  it('refuses an inline event handler, and says which, because the policy would refuse to run it', () => {
    expect(() =>
      inlineScriptHashes(page('', '    <link rel="stylesheet" href="s.css" onload="this.media=\'all\'">\n')),
    ).toThrow(/inline event handler \(onload\).*'unsafe-inline'/);
    expect(() => inlineScriptHashes(page('<button onclick="go()">x</button>'))).toThrow(/\(onclick\)/);
  });

  it('refuses a javascript: URL', () => {
    expect(() => inlineScriptHashes(page('<a href="javascript:go()">x</a>'))).toThrow(/javascript: URL/);
    expect(() => inlineScriptHashes(page('<form action=" javascript:go()"></form>'))).toThrow(/javascript: URL/);
  });

  it.each([
    ['a script from another host', '<script src="https://cdn.example/x.js"></script>', 'https://cdn.example/x.js'],
    ['a script from a protocol-relative address', '<script src="//cdn.example/x.js"></script>', '//cdn.example/x.js'],
    [
      'a style sheet from another host',
      '<link rel="stylesheet" href="http://fonts.example/f.css">',
      'http://fonts.example/f.css',
    ],
  ])('refuses %s, and says which', (_description, tag, address) => {
    expect(() => inlineScriptHashes(page(tag))).toThrow(
      new RegExp(`loads ${address.replace(/[./]/g, '\\$&')}.*another origin`),
    );
  });

  it('does not take the text of a script or of a style for tags: the code of the page may say onload and compare', () => {
    const body = "<script>if (a<b && c>d) { el.onload = go; var s = '<a onclick=1>'; }</script>";
    const head = '    <style>a[href^="https://x"]{color:red}</style>\n';

    expect(inlineScriptHashes(page(body, head))).toHaveLength(1);
  });

  it('allows a link to another site, which the page opens and does not load', () => {
    expect(
      inlineScriptHashes(page('<a href="https://github.com/RafaelJCamara/RabbitMqPlayground">Source</a>')),
    ).toEqual([]);
  });
});

describe('contentSecurityPolicy', () => {
  it('is the same ten directives, in order, for a page with no inline script', () => {
    expect(contentSecurityPolicy(page())).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  });

  it('puts the hash of each inline script in script-src, after the page’s own files, and in no other directive', () => {
    const policy = contentSecurityPolicy(page(`<script>${BEASTIES_SCRIPT}</script>`));

    expect(sources(policy, 'script-src')).toEqual(["'self'", BEASTIES]);
    expect(policy.split(BEASTIES)).toHaveLength(2);
  });

  it('never lets a script run from text: no eval, no inline scripts without a hash, no other origin', () => {
    const policy = contentSecurityPolicy(page('<script>alert(1)</script><script>a\nb</script>'));

    expect(
      sources(policy, 'script-src').filter((source) => source !== "'self'" && !source.startsWith("'sha256-")),
    ).toEqual([]);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('wasm-unsafe-eval');
    expect(policy).not.toContain('strict-dynamic');
    expect(policy).not.toMatch(/https?:|\*/);
  });

  it('allows an inline style, which the components of Angular make and which cannot run code', () => {
    expect(sources(contentSecurityPolicy(page()), 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('allows a worker made from a blob, for the worker of a library, and no plug-in at all', () => {
    const policy = contentSecurityPolicy(page());

    expect(sources(policy, 'worker-src')).toEqual(["'self'", 'blob:']);
    expect(sources(policy, 'object-src')).toEqual(["'none'"]);
  });

  it('does not say what a policy in a meta cannot: frame-ancestors, report-uri and sandbox', () => {
    const policy = contentSecurityPolicy(page());

    expect(policy).not.toMatch(/frame-ancestors|report-uri|report-to|sandbox/);
  });
});

describe('withContentSecurityPolicy', () => {
  const META = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;

  it('puts the policy in a meta right after the character set, before anything else can run', () => {
    const made = withContentSecurityPolicy(page(`<script>${BEASTIES_SCRIPT}</script>`));

    const charset = made.indexOf('<meta charset="utf-8">');
    const meta = made.search(META);
    expect(charset).toBeGreaterThan(-1);
    expect(meta).toBeGreaterThan(charset);
    expect(made.slice(charset + '<meta charset="utf-8">'.length, meta).trim()).toBe('');
    expect(meta).toBeLessThan(made.indexOf('<title>'));
    expect(meta).toBeLessThan(made.indexOf('<script'));
  });

  it('says in the meta the policy of the page, with the hash of its inline script', () => {
    const html = page(`<script>${BEASTIES_SCRIPT}</script>`);

    const made = withContentSecurityPolicy(html);

    expect(META.exec(made)?.[1]).toBe(contentSecurityPolicy(html));
    expect(META.exec(made)?.[1]).toContain(BEASTIES);
  });

  it('changes nothing else in the page', () => {
    const html = page(`<script>${BEASTIES_SCRIPT}</script>`);

    const made = withContentSecurityPolicy(html);

    expect(made.replace(/\n {4}<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).toBe(html);
  });

  it('puts it at the start of the head when there is no character set to follow', () => {
    const made = withContentSecurityPolicy('<html><head><title>x</title></head><body></body></html>');

    expect(made.startsWith('<html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('makes the same page when it is made twice: a policy that the page had is replaced, not added to', () => {
    const once = withContentSecurityPolicy(page(`<script>${BEASTIES_SCRIPT}</script>`));
    const twice = withContentSecurityPolicy(once);

    expect(twice).toBe(once);
    expect(twice.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('replaces a policy that the page had with the one that it needs', () => {
    const old = '<meta http-equiv="content-security-policy" content="default-src *">';
    const made = withContentSecurityPolicy(page('', `    ${old}\n`));

    expect(made).not.toContain('default-src *');
    expect(made.match(/Content-Security-Policy/gi)).toHaveLength(1);
  });

  it('refuses a page that has no head to put it in', () => {
    expect(() => withContentSecurityPolicy('<rmq-root></rmq-root>')).toThrow(/no <head>/);
  });

  it('refuses a page that the policy would break, and writes nothing of it', () => {
    expect(() => withContentSecurityPolicy(page('<script src="https://cdn.example/x.js"></script>'))).toThrow(
      /another origin/,
    );
  });
});
