// Copies exam JSON and question images from the Flutter app, keeping the same
// paths (assets/provas/<category>/*.json, assets/images/*), so every path
// inside the JSON stays valid.
//
//   node scripts/sync-assets.mjs [path-to-flutter-repo]
//   FLUTTER_REPO=../concursero node scripts/sync-assets.mjs
import { cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const CATEGORIES = ['oab', 'enem'];

const flutterRepo = process.argv[2] ?? process.env.FLUTTER_REPO;
if (!flutterRepo) {
  console.error('Usage: node scripts/sync-assets.mjs <path-to-flutter-repo>  (or set FLUTTER_REPO)');
  process.exit(1);
}

const source = path.resolve(flutterRepo, 'assets');
const target = path.resolve(import.meta.dirname, '..', 'assets');

for (const category of CATEGORIES) {
  const dir = path.join(source, 'provas', category);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  for (const file of files) await cp(path.join(dir, file), path.join(target, 'provas', category, file));
  console.log(`provas/${category}: ${files.length} exams`);
}

const images = path.join(source, 'images');
if (await stat(images).catch(() => null)) {
  await cp(images, path.join(target, 'images'), { recursive: true });
  console.log(`images: ${(await readdir(images)).length} files`);
}
