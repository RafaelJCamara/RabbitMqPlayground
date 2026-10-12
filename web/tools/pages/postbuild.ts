import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withContentSecurityPolicy } from './csp';

/**
 * What a Pages build needs on top of `ng build`:
 *
 * - A content security policy (ADR-0078), in a `<meta>` of `index.html`, made from the page that the build made: the hash of each inline script
 *   is in it, and a page with something the policy would break is refused here and not in a visitor's browser.
 * - `404.html`, a copy of `index.html`. GitHub Pages serves it for every path it has no file for, so a deep link
 *   still loads the single-page app.
 * - `<meta name="rmq-build">` in `index.html` (ADR-0109), which says which commit the bundle next to it was built from. The app shows it at the foot of a page.
 * - `build-info.json`, which says which commit the build came from. The post-deploy smoke test polls it, because
 *   Pages' CDN can keep serving the previous deploy for a few minutes.
 */

export interface BuildInfo {
  readonly commit: string;
  readonly ref: string;
  readonly builtAt: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function createBuildInfo(env: Env, now: Date): BuildInfo {
  return {
    commit: env['GITHUB_SHA'] ?? 'local',
    ref: env['GITHUB_REF_NAME'] ?? 'local',
    builtAt: now.toISOString(),
  };
}

const BUILD_META = /\s*<meta\b[^>]*\bname\s*=\s*["']?rmq-build["']?[^>]*>/gi;
const CHARSET_META = /<meta\b[^>]*\bcharset\b[^>]*>/i;
/** What a commit may be made of: a hash, or `local`. Anything else would be put in an attribute of the page. */
const COMMIT = /^[A-Za-z0-9._-]+$/;

/** The page with the commit in a `<meta>` after the charset, and with the one that it had taken out, so that making the page again makes the same page. */
export function withBuildMeta(html: string, commit: string): string {
  if (!COMMIT.test(commit)) {
    throw new Error(`The commit "${commit}" is not a hash. It would be put in an attribute of index.html.`);
  }
  const bare = html.replace(BUILD_META, '');
  const meta = `<meta name="rmq-build" content="${commit}" />`;
  if (!CHARSET_META.test(bare)) {
    throw new Error('index.html has no <meta charset>, which the build stamp is put after.');
  }
  return bare.replace(CHARSET_META, (charset) => `${charset}${meta}`);
}

export function addPagesFiles(distDir: string, info: BuildInfo): void {
  const index = join(distDir, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`There is no index.html in ${distDir}. Build the app first.`);
  }
  writeFileSync(index, withContentSecurityPolicy(withBuildMeta(readFileSync(index, 'utf8'), info.commit)));
  copyFileSync(index, join(distDir, '404.html'));
  writeFileSync(join(distDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: tsx tools/pages/postbuild.ts <dist directory>');
    process.exit(2);
  }
  addPagesFiles(distDir, createBuildInfo(process.env, new Date()));
  console.log(`Added the content security policy, 404.html and build-info.json to ${distDir}`);
}
