// Builds dist-cf/, the static files for the Cloudflare Worker (wrangler.toml):
//   dist-cf/concursero-angular/                 Angular app built for that base path
//   dist-cf/concursero-angular/assets/provas/   exam JSON + catalog.json (the Worker's exam index)
//   dist-cf/concursero-angular/assets/images/   question images (from `npm run sync-assets`)
//
//   node scripts/build-cloudflare.mjs     (then: npx wrangler deploy)
import { execSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_BY_FOLDER, summarize } from '../server/src/exams/catalog.ts';

const BASE = 'concursero-angular';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist-cf', BASE);

execSync(`npm --prefix client run build -- --base-href /${BASE}/`, { cwd: root, stdio: 'inherit' });

await rm(path.join(root, 'dist-cf'), { recursive: true, force: true });
await cp(path.join(root, 'client', 'dist', 'client', 'browser'), out, { recursive: true });

const catalog = [];
for (const [folder, category] of Object.entries(CATEGORY_BY_FOLDER)) {
  const dir = path.join(root, 'assets', 'provas', folder);
  await mkdir(path.join(out, 'assets', 'provas', folder), { recursive: true });
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
    const relative = `assets/provas/${folder}/${file}`;
    await cp(path.join(dir, file), path.join(out, relative));
    catalog.push(summarize(category, relative, JSON.parse(await readFile(path.join(dir, file), 'utf8'))));
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
