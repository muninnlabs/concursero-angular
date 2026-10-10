// Shapes of the exam JSON files shared with the Flutter app
// (assets/provas/<category>/<exam>.json). Keep in sync with its Question model.

export interface ExamFile {
  exam_metadata: ExamMetadata;
  questions: Question[];
}

export interface ExamMetadata {
  exam_id: string;
  exam_name: string;
  institution: string;
  year: number;
  day: number;
  booklet_color: string;
  /** Readable name for exams whose id examLabel() can't decode (concursos), e.g. "ANP 2022 · Conhecimentos gerais". */
  label?: string;
  /** Concursos only: where the exam belongs and which concurso (edital) it is part of. */
  level?: ConcursoLevel;
  uf?: string | null;
  municipio?: string | null;
  concurso?: { id: string; name: string };
  /** Set by the data pipeline when the whole exam must not be served ("incomplete", "superseded"). */
  status?: string;
}

export type ConcursoLevel = 'federal' | 'estadual' | 'municipal';

/** A concurso (one edital) and where it belongs, for the Concursos filters. */
export interface ConcursoInfo {
  id: string;
  /** e.g. "PRF 2021", "TCE RJ 2022 Procurador" */
  name: string;
  institution: string;
  level: ConcursoLevel;
  uf: string | null;
  municipio: string | null;
  year: number;
}

/** Filters for practice questions; every field is optional. */
export interface QuestionFilter {
  category?: string;
  subject?: string;
  level?: string;
  uf?: string;
  municipio?: string;
  concurso?: string;
}

export interface Question {
  id: string;
  question_number: number;
  subject: string | null;
  topic: string | null;
  foreign_language: string | null;
  context_texts: ContextText[];
  /** A single path, or (in ~550 ENEM questions) a list of paths. */
  image_url: string | string[] | null;
  statement: string;
  options: QuestionOption[];
  correct_answer: string | null;
  /** Set by the data pipeline when a figure/option couldn't be recovered; hidden until fixed. */
  review?: { status: string; reasons: string[] };
}

export interface ContextText {
  type: string;
  title?: string | null;
  content?: string | null;
  source?: string | null;
  image_url?: string | null;
}

export interface QuestionOption {
  letter: string;
  text: string;
  image_url?: string | null;
  is_correct: boolean;
}

/**
 * A question as sent to the browser: the answer key stays on the server and
 * image_url is normalized to image_urls (always a list).
 */
export type PublicQuestion = Omit<Question, 'correct_answer' | 'options' | 'image_url'> & {
  image_urls: string[];
  examId: string;
  /** e.g. "ENEM 2013 · Dia 1 · Caderno Azul" */
  examLabel: string;
  options: Omit<QuestionOption, 'is_correct'>[];
};

export interface ExamSummary {
  id: string;
  category: string;
  /** Name as printed in the exam file (exam_metadata.exam_name). */
  name: string;
  /** Readable name, e.g. "ENEM 2013 · Dia 1 · Caderno Azul". */
  label: string;
  institution: string;
  year: number;
  day: number;
  booklet: string;
  /** Same relative path the Flutter app uses, e.g. assets/provas/oab/oab_2010_1_tipo1.json */
  path: string;
  questionCount: number;
  /** Questions that can be practised: valid answer key and complete content. */
  gradableCount: number;
  subjects: string[];
  /** Practisable questions per subject (questions without a subject aren't counted). */
  subjectCounts: Record<string, number>;
  /** Concursos only. */
  concurso?: ConcursoInfo;
}
