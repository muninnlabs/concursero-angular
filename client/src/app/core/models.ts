// Mirrors the API's JSON (server/src). Question fields keep the snake_case of
// the exam files shared with the Flutter app.

export type Plan = 'free' | 'premium';

/** App profile; `id` is the Firebase uid. */
export interface User {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  createdAt: string;
}

export interface Catalog {
  totalQuestions: number;
  categories: { category: string; examCount: number; questionCount: number }[];
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
}

/** A question without its answer key: grading happens on the server. */
export interface Question {
  id: string;
  examId: string;
  /** e.g. "ENEM 2013 · Dia 1 · Caderno Azul" */
  examLabel: string;
  question_number: number;
  subject: string | null;
  topic: string | null;
  foreign_language: string | null;
  context_texts: ContextText[];
  /** Normalized by the API: always a list (possibly empty). */
  image_urls: string[];
  statement: string;
  options: QuestionOption[];
}

export interface GradedAnswer {
  questionId: string;
  selected: string;
  isCorrect: boolean;
  correctAnswer: string;
}

export interface Simulado {
  id: string;
  category: string;
  title: string;
  total: number;
  correct: number;
  finishedAt: string;
}

export interface UserStats {
  answered: number;
  correct: number;
  accuracy: number;
  streakDays: number;
  bySubject: SubjectStats[];
}

export interface SubjectStats {
  subject: string;
  answered: number;
  correct: number;
  /** Distinct questions answered at least once. */
  questions: number;
}

/** A subject and how many practisable questions it has. */
export interface SubjectInfo {
  subject: string;
  category: string;
  questionCount: number;
  examCount: number;
}

export interface PeriodTotals {
  answered: number;
  correct: number;
  avgSeconds: number | null;
}

export interface ActivityStats {
  days: { day: string; correct: number; wrong: number }[];
  current: PeriodTotals;
  previous: PeriodTotals;
  bySubject: SubjectStats[];
  ranking: { topPercent: number; users: number } | null;
}
