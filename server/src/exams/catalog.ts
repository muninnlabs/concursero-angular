import type { ExamFile, ExamSummary, PublicQuestion, Question } from './types.ts';

/** Folder name under assets/provas → category shown in the app. */
export const CATEGORY_BY_FOLDER: Record<string, string> = {
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

export function summarize(category: string, relativePath: string, data: ExamFile): ExamSummary {
  const meta = data.exam_metadata;
  return {
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
    subjects: [...new Set(data.questions.map((q) => q.subject).filter((s) => s != null))],
  };
}

export interface LoadedExam {
  summary: ExamSummary;
  questions: Question[];
}

/**
 * Where exams come from. Node loads every file into memory at startup;
 * the Cloudflare Worker reads catalog.json and fetches one exam file at a
 * time, because parsing all 7 MB per request would blow its CPU budget.
 */
export interface ExamSource {
  /** Every exam's summary, newest first. */
  list(): Promise<ExamSummary[]>;
  get(examId: string): Promise<LoadedExam | undefined>;
}

export function sortSummaries(summaries: ExamSummary[]): ExamSummary[] {
  return [...summaries].sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
}

/** Holds already-parsed exams (Node, tests). */
export class MemoryExamSource implements ExamSource {
  private readonly exams = new Map<string, LoadedExam>();

  add(category: string, relativePath: string, data: ExamFile) {
    const summary = summarize(category, relativePath, data);
    if (this.exams.has(summary.id)) throw new Error(`Duplicate exam_id ${summary.id} in ${relativePath}`);
    this.exams.set(summary.id, { summary, questions: data.questions });
  }

  async list() {
    return sortSummaries([...this.exams.values()].map((e) => e.summary));
  }

  async get(examId: string) {
    return this.exams.get(examId);
  }
}

export interface PickedQuestion {
  question: Question;
  exam: ExamSummary;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Random gradable questions. Draws from a handful of random exams rather than
 * the whole pool, so the Worker only has to load a few files per request.
 */
export async function randomQuestions(
  source: ExamSource,
  count: number,
  filter: { category?: string; subject?: string } = {},
): Promise<PickedQuestion[]> {
  const exams = shuffle(
    (await source.list()).filter(
      (e) =>
        e.gradableCount > 0 &&
        (!filter.category || e.category === filter.category) &&
        (!filter.subject || e.subjects.includes(filter.subject)),
    ),
  );

  const picked: PickedQuestion[] = [];
  const examsToUse = Math.min(exams.length, Math.max(1, Math.ceil(count / 4)));
  for (let i = 0; i < exams.length && (i < examsToUse || picked.length < count); i++) {
    const exam = await source.get(exams[i].id);
    if (!exam) continue;
    const pool = exam.questions.filter((q) => isGradable(q) && (!filter.subject || q.subject === filter.subject));
    for (const question of shuffle(pool).slice(0, Math.ceil(count / examsToUse))) {
      picked.push({ question, exam: exam.summary });
    }
  }
  return shuffle(picked).slice(0, count);
}
