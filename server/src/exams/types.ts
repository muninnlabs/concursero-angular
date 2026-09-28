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
}

export interface Question {
  id: string;
  question_number: number;
  subject: string | null;
  topic: string | null;
  foreign_language: string | null;
  context_texts: ContextText[];
  image_url: string | null;
  statement: string;
  options: QuestionOption[];
  correct_answer: string | null;
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

/** A question as sent to the browser: the answer key stays on the server. */
export type PublicQuestion = Omit<Question, 'correct_answer' | 'options'> & {
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
  /** Questions with a usable answer key (annulled / unparsed ones excluded). */
  gradableCount: number;
  subjects: string[];
}
