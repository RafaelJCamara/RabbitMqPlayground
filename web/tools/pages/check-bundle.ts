import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Fails when a built bundle contains text it must not. CI uses it to prove that the debug handle (`__rmq`) is not in
 * the deployed build: it is behind a build-time constant, and this checks that the constant did its job.
 */

export interface Finding {
  readonly file: string;
  readonly text: string;
}

const SCANNED = new Set(['.js', '.mjs', '.html', '.css']);

export function findForbidden(files: Readonly<Record<string, string>>, forbidden: readonly string[]): Finding[] {
  return Object.entries(files).flatMap(([file, content]) =>
    forbidden.filter((text) => content.includes(text)).map((text) => ({ file, text })),
  );
}

export function readBundle(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((name) => SCANNED.has(extname(name)))
      .map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, ...forbidden] = process.argv.slice(2);
  if (!dir || forbidden.length === 0) {
    console.error('Usage: tsx tools/pages/check-bundle.ts <dist directory> <forbidden text>...');
    process.exit(2);
  }
  const bundle = readBundle(dir);
  if (Object.keys(bundle).length === 0) {
    console.error(`No .js, .html or .css files in ${dir}. Build the app first.`);
    process.exit(2);
  }
  const findings = findForbidden(bundle, forbidden);
  for (const { file, text } of findings) {
    console.error(`${file} contains "${text}"`);
  }
  if (findings.length > 0) {
    process.exit(1);
  }
  console.log(`${Object.keys(bundle).length} files in ${dir} are free of: ${forbidden.join(', ')}`);
}
