import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExamFile, ExamSummary, PublicQuestion, Question } from './types.ts';

/** Folder name under assets/provas → category shown in the app. */
const CATEGORY_BY_FOLDER: Record<string, string> = {
  oab: 'OAB',
  enem: 'ENEM',
};

const VALID_ANSWER = /^[A-E]$/;

export function isGradable(question: Question): boolean {
  return question.correct_answer != null && VALID_ANSWER.test(question.correct_answer);
}

export function toPublicQuestion(question: Question, examId: string): PublicQuestion {
  const { correct_answer: _answer, options, ...rest } = question;
  return {
    ...rest,
    examId,
    options: options.map(({ is_correct: _correct, ...option }) => option),
  };
}

interface IndexedQuestion {
  question: Question;
  exam: ExamSummary;
}

/**
 * Read-only view over the exam JSON files. Everything is loaded into memory at
 * startup (~13 MB of JSON), so lookups are synchronous afterwards.
 */
export class ExamCatalog {
  private readonly exams = new Map<string, { summary: ExamSummary; questions: Question[] }>();
  // Question ids aren't always prefixed with their exam id (e.g. 2024_d1_cd1.json),
  // so look them up through an index instead of parsing the id.
  private readonly questions = new Map<string, IndexedQuestion>();

  static async load(assetsDir: string): Promise<ExamCatalog> {
    const catalog = new ExamCatalog();
    const provasDir = path.join(assetsDir, 'provas');

    for (const [folder, category] of Object.entries(CATEGORY_BY_FOLDER)) {
      const dir = path.join(provasDir, folder);
      const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));

      for (const file of files.sort()) {
        const data = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as ExamFile;
        catalog.add(category, `assets/provas/${folder}/${file}`, data);
      }
    }
    return catalog;
  }

  private add(category: string, relativePath: string, data: ExamFile) {
    const meta = data.exam_metadata;
    if (this.exams.has(meta.exam_id)) {
      throw new Error(`Duplicate exam_id ${meta.exam_id} in ${relativePath}`);
    }
    const subjects = [...new Set(data.questions.map((q) => q.subject).filter((s) => s != null))];
    const summary: ExamSummary = {
      id: meta.exam_id,
      category,
      name: meta.exam_name,
      institution: meta.institution,
      year: meta.year,
      day: meta.day,
      booklet: meta.booklet_color,
      path: relativePath,
      questionCount: data.questions.length,
      gradableCount: data.questions.filter(isGradable).length,
      subjects,
    };
    this.exams.set(meta.exam_id, { summary, questions: data.questions });
    for (const question of data.questions) {
      this.questions.set(question.id, { question, exam: summary });
    }
  }

  categories(): string[] {
    return [...new Set([...this.exams.values()].map((e) => e.summary.category))];
  }

  list(category?: string): ExamSummary[] {
    return [...this.exams.values()]
      .map((e) => e.summary)
      .filter((e) => !category || e.category === category)
      .sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
  }

  getExam(examId: string) {
    return this.exams.get(examId);
  }

  getQuestion(questionId: string): IndexedQuestion | undefined {
    return this.questions.get(questionId);
  }

  totalQuestions(): number {
    return this.questions.size;
  }

  /** Random gradable questions, optionally limited to one category / subject. */
  randomQuestions(count: number, filter: { category?: string; subject?: string } = {}): IndexedQuestion[] {
    const pool = [...this.questions.values()].filter(
      ({ question, exam }) =>
        isGradable(question) &&
        (!filter.category || exam.category === filter.category) &&
        (!filter.subject || question.subject === filter.subject),
    );
    // Partial Fisher–Yates: only shuffle as many as we need.
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }
}
