import type { ConcursoInfo, ExamFile, ExamSummary, PublicQuestion, Question, QuestionFilter } from './types.ts';

/** Folder name under assets/provas → category shown in the app. */
export const CATEGORY_BY_FOLDER: Record<string, string> = {
  oab: 'OAB',
  enem: 'ENEM',
  concursos: 'CONCURSOS',
  vestibulares: 'VESTIBULARES',
};

const VALID_ANSWER = /^[A-E]$/;

export function isGradable(question: Question): boolean {
  return question.correct_answer != null && VALID_ANSWER.test(question.correct_answer);
}

function imageList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((url) => typeof url === 'string' && url.trim() !== '');
}

/**
 * Whether a question can be shown at all: it needs something to read
 * (statement, context or image) and at least two options, each with text or an
 * image. Filters out unfinished extractions (ENEM 2010, options that were
 * images the pipeline didn't capture, ...).
 */
export function isUsable(question: Question): boolean {
  if (question.review) return false;
  const hasBody =
    !!question.statement?.trim() ||
    imageList(question.image_url).length > 0 ||
    question.context_texts.some((c) => !!c.content?.trim() || !!c.image_url);
  const options = question.options ?? [];
  return hasBody && options.length >= 2 && options.every((o) => !!o.text?.trim() || !!o.image_url);
}

/** Can be served in practice and graded. */
export function isPlayable(question: Question): boolean {
  return isGradable(question) && isUsable(question);
}

/**
 * Human-readable exam name from its id, e.g.
 *   enem_2013_d1_azul            → "ENEM 2013 · Dia 1 · Caderno Azul"
 *   oab_2025_44_tipo1            → "OAB · 44º Exame (2025) · Tipo 1"
 *   oab_2012_6_reaplicacao_tipo1 → "OAB · 6º Exame (2012) · Reaplicação · Tipo 1"
 * Unknown formats fall back to the id itself.
 */
export function examLabel(examId: string): string {
  const enem = /^enem_(\d{4})_d(\d)_([a-z]+)$/.exec(examId);
  if (enem) {
    const [, year, day, color] = enem;
    return `ENEM ${year} · Dia ${day} · Caderno ${color[0].toUpperCase()}${color.slice(1)}`;
  }
  const oab = /^oab_(\d{4})_(\d+)_(?:([a-z]+)_)?tipo(\d)$/.exec(examId);
  if (oab) {
    const [, year, number, variant, type] = oab;
    const variants: Record<string, string> = { reaplicacao: 'Reaplicação', salvador: 'Salvador' };
    const extra = variant ? ` · ${variants[variant] ?? variant}` : '';
    return `OAB · ${number}º Exame (${year})${extra} · Tipo ${type}`;
  }
  return examId;
}

export function toPublicQuestion(question: Question, examId: string, label = examLabel(examId)): PublicQuestion {
  const { correct_answer: _answer, options, image_url, ...rest } = question;
  return {
    ...rest,
    image_urls: imageList(image_url),
    examId,
    examLabel: label,
    options: options.map(({ is_correct: _correct, ...option }) => option),
  };
}

function countSubjects(questions: Question[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { subject } of questions) if (subject) counts[subject] = (counts[subject] ?? 0) + 1;
  return counts;
}

export function summarize(category: string, relativePath: string, data: ExamFile): ExamSummary {
  const meta = data.exam_metadata;
  return {
    id: meta.exam_id,
    category,
    name: meta.exam_name,
    label: meta.label ?? examLabel(meta.exam_id),
    institution: meta.institution,
    year: meta.year,
    day: meta.day,
    booklet: meta.booklet_color,
    path: relativePath,
    questionCount: data.questions.length,
    gradableCount: data.questions.filter(isPlayable).length,
    subjects: [...new Set(data.questions.map((q) => q.subject).filter((s) => s != null))],
    subjectCounts: countSubjects(data.questions.filter(isPlayable)),
    ...(meta.concurso && meta.level
      ? {
          concurso: {
            id: meta.concurso.id,
            name: meta.concurso.name,
            institution: meta.institution,
            level: meta.level,
            uf: meta.uf ?? null,
            municipio: meta.municipio ?? null,
            year: meta.year,
          },
        }
      : {}),
  };
}

/**
 * Whether an exam matches the level / state / município / institution / concurso filters (exams without concurso
 * info, i.e. ENEM and OAB, never do).
 */
export function matchesConcurso(exam: ExamSummary, filter: QuestionFilter): boolean {
  if (!filter.level && !filter.uf && !filter.municipio && !filter.institution && !filter.concurso) return true;
  const c: ConcursoInfo | undefined = exam.concurso;
  return (
    !!c &&
    (!filter.level || c.level === filter.level) &&
    (!filter.uf || c.uf === filter.uf) &&
    (!filter.municipio || c.municipio === filter.municipio) &&
    (!filter.institution || c.institution === filter.institution) &&
    (!filter.concurso || c.id === filter.concurso)
  );
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
    if (data.exam_metadata.status) return; // incomplete / superseded exams aren't served
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
  filter: QuestionFilter = {},
): Promise<PickedQuestion[]> {
  const exams = shuffle(
    (await source.list()).filter(
      (e) =>
        e.gradableCount > 0 &&
        (!filter.category || e.category === filter.category) &&
        (!filter.subject || e.subjects.includes(filter.subject)) &&
        matchesConcurso(e, filter),
    ),
  );

  const picked: PickedQuestion[] = [];
  const examsToUse = Math.min(exams.length, Math.max(1, Math.ceil(count / 4)));
  for (let i = 0; i < exams.length && (i < examsToUse || picked.length < count); i++) {
    const exam = await source.get(exams[i].id);
    if (!exam) continue;
    const pool = exam.questions.filter((q) => isPlayable(q) && (!filter.subject || q.subject === filter.subject));
    for (const question of shuffle(pool).slice(0, Math.ceil(count / examsToUse))) {
      picked.push({ question, exam: exam.summary });
    }
  }
  return shuffle(picked).slice(0, count);
}
