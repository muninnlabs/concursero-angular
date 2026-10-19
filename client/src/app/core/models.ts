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
  bio: string | null;
  location: string | null;
}

export interface Catalog {
  totalQuestions: number;
  categories: { category: string; examCount: number; questionCount: number }[];
}

/** Concursos: federal / estadual / municipal. Vestibulares: federal / estadual / privada. */
export type ConcursoLevel = 'federal' | 'estadual' | 'municipal' | 'privada';

/** A concurso (one edital) or vestibular (one edition) with practisable questions, from GET /api/concursos. */
export interface ConcursoInfo {
  id: string;
  category: string;
  /** e.g. "PRF 2021" */
  name: string;
  institution: string;
  level: ConcursoLevel;
  uf: string | null;
  municipio: string | null;
  year: number;
  examCount: number;
  questionCount: number;
}

/** Narrows Concursos / Vestibulares practice; every field is optional. */
export interface ConcursoFilter {
  level?: ConcursoLevel;
  uf?: string;
  municipio?: string;
  /** The órgão or university. */
  institution?: string;
  concurso?: string;
}

export interface ContextText {
  type: string;
  title?: string | null;
  content?: string | null;
  source?: string | null;
  image_url?: string | null;
  /** A passage printed with line numbers: its lines as printed, `n` where the margin shows a number. */
  lines?: { n: number | null; text: string }[] | null;
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
  /** Why the correct alternative is correct, when the banca published it. */
  explanation?: string;
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

/** "Análise Avançada" (Premium), GET /api/me/insights. Accuracy is derived from answered/correct. */
export interface Insights {
  /** Null for all time. */
  days: number | null;
  totals: PeriodTotals;
  /** Mean seconds on questions answered right / wrong. */
  timing: { correct: number | null; wrong: number | null };
  bySubject: { subject: string; answered: number; correct: number; avgSeconds: number | null }[];
  /** Up to 5 subjects with at least 5 answers, lowest accuracy first. */
  weakest: { subject: string; answered: number; correct: number; avgSeconds: number | null }[];
  byYear: { year: number; answered: number; correct: number }[];
  byInstitution: { institution: string; answered: number; correct: number }[];
  byDayPart: { part: 'madrugada' | 'manha' | 'tarde' | 'noite'; answered: number; correct: number }[];
  /** The last 12 weeks, oldest first; `start` is the Monday (YYYY-MM-DD). */
  weekly: { start: string; answered: number; correct: number }[];
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  /** An IconName (shared/icon.ts). */
  icon: string;
  tone: 'amber' | 'green' | 'blue' | 'purple' | 'rose' | 'indigo';
  unlocked: boolean;
  progress: number;
  target: number;
  detail?: string;
}

export interface RankingEntry {
  position: number;
  /** Full name for the user, "Ana S." for everyone else. */
  name: string;
  xp: number;
  you: boolean;
}

export interface StudentProfile {
  user: User;
  xp: number;
  level: { level: number; levelXp: number; nextLevelXp: number };
  streak: { current: number; longest: number; practicedToday: boolean };
  /** The user's local today, YYYY-MM-DD. */
  today: string;
  /** Days with answers in the last 26 weeks. */
  activity: { day: string; count: number }[];
  badges: Badge[];
  ranking: { entries: RankingEntry[]; users: number };
}
