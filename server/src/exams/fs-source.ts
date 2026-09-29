import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_BY_FOLDER, MemoryExamSource } from './catalog.ts';
import type { ExamFile } from './types.ts';

/** Loads every exam under <assetsDir>/provas/<folder>/*.json into memory (Node only). */
export async function loadExamsFromDisk(assetsDir: string): Promise<MemoryExamSource> {
  const source = new MemoryExamSource();
  for (const [folder, category] of Object.entries(CATEGORY_BY_FOLDER)) {
    const dir = path.join(assetsDir, 'provas', folder);
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'catalog.json');
    for (const file of files.sort()) {
      const data = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as ExamFile;
      source.add(category, `assets/provas/${folder}/${file}`, data);
    }
  }
  return source;
}
