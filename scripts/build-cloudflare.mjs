// Builds dist-cf/, the static files for the Cloudflare Worker (wrangler.toml), for the app at
// the root of the domain (BASE_PATH "/"):
//   dist-cf/                 Angular app
//   dist-cf/assets/provas/   exam JSON + catalog.json (the Worker's exam index)
//   dist-cf/assets/images/   question images (from `npm run sync-assets`)
//
//   node scripts/build-cloudflare.mjs                           (production, then: npx wrangler deploy)
//   node scripts/build-cloudflare.mjs --out dist-cf-staging     (then: npx wrangler deploy --env staging)
//   --base /some-path/ builds for a sub-path instead (must match BASE_PATH).
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_BY_FOLDER, summarize } from '../server/src/exams/catalog.ts';
import { withExplanations } from '../server/src/exams/explanations.ts';

const { values } = parseArgs({ options: { base: { type: 'string', default: '/' }, out: { type: 'string', default: 'dist-cf' } } });
/** The public path, without slashes ('' at the root of the domain). Must match BASE_PATH in wrangler.toml. */
const BASE = values.base.replace(/^\/+|\/+$/g, '');
const root = path.resolve(import.meta.dirname, '..');
const distCf = path.join(root, values.out);
const out = path.join(distCf, BASE);

execSync(`npm --prefix client run build -- --base-href ${BASE ? `/${BASE}/` : '/'}`, { cwd: root, stdio: 'inherit' });

// Empty dist-cf rather than deleting it: on Windows the folder itself stays
// locked (EBUSY) while an Explorer or editor window has it open.
await mkdir(distCf, { recursive: true });
for (const entry of await readdir(distCf)) {
  await rm(path.join(distCf, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
await cp(path.join(root, 'client', 'dist', 'client', 'browser'), out, { recursive: true });

const catalog = [];
for (const [folder, category] of Object.entries(CATEGORY_BY_FOLDER)) {
  const dir = path.join(root, 'assets', 'provas', folder);
  // Generated explanations are merged into the served copy of each exam.
  const explanations = await readFile(path.join(root, 'assets', 'explanations', `${folder}.json`), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
  await mkdir(path.join(out, 'assets', 'provas', folder), { recursive: true });
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
    const relative = `assets/provas/${folder}/${file}`;
    const data = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (data.exam_metadata.status) continue; // incomplete / superseded exams aren't served
    await writeFile(path.join(out, relative), JSON.stringify(withExplanations(data, explanations)));
    catalog.push(summarize(category, relative, data));
  }
}
await writeFile(path.join(out, 'assets', 'provas', 'catalog.json'), JSON.stringify(catalog));

const images = path.join(root, 'assets', 'images');
if (await stat(images).catch(() => null)) {
  await cp(images, path.join(out, 'assets', 'images'), { recursive: true });
} else {
  console.warn('assets/images missing: question images won\'t load (run npm run sync-assets first)');
}
console.log(`dist-cf ready: ${catalog.length} exams`);
