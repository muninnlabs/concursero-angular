import { sortSummaries, type ExamSource, type LoadedExam } from './catalog.ts';
import type { ExamFile, ExamSummary } from './types.ts';

/**
 * Cloudflare Worker exam source: exams are static assets, read through the
 * ASSETS binding. catalog.json (generated at build time) lists them; exam
 * files are fetched on demand and cached for the life of the isolate.
 */
export class AssetsExamSource implements ExamSource {
  private summaries?: Promise<ExamSummary[]>;
  private readonly cache = new Map<string, Promise<LoadedExam | undefined>>();
  private readonly assets: Fetcher;
  private readonly basePath: string;

  /** `basePath` is the public path the assets live under, e.g. "/concursero-angular/". */
  constructor(assets: Fetcher, basePath: string) {
    this.assets = assets;
    this.basePath = basePath;
  }

  private fetchJson<T>(relativePath: string): Promise<T | undefined> {
    const url = new URL(this.basePath + relativePath, 'https://assets.local');
    return this.assets.fetch(url.toString()).then((res) => (res.ok ? (res.json() as Promise<T>) : undefined));
  }

  list(): Promise<ExamSummary[]> {
    this.summaries ??= this.fetchJson<ExamSummary[]>('assets/provas/catalog.json').then((list) => {
      if (!list) throw new Error('assets/provas/catalog.json is missing; run the Cloudflare build');
      return sortSummaries(list);
    });
    return this.summaries;
  }

  get(examId: string): Promise<LoadedExam | undefined> {
    let entry = this.cache.get(examId);
    if (!entry) {
      entry = this.list().then(async (list) => {
        const summary = list.find((e) => e.id === examId);
        if (!summary) return undefined;
        const data = await this.fetchJson<ExamFile>(summary.path);
        return data && { summary, questions: data.questions };
      });
      // Don't cache failures: the next request should try again.
      entry.catch(() => this.cache.delete(examId));
      this.cache.set(examId, entry);
    }
    return entry;
  }
}
