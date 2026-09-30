// Everything the app persists lives behind this interface. Exams themselves are
// never stored here: they're read from the JSON files by an ExamSource.
// Implementations: SqliteUserStore (Node, local development) and D1UserStore
// (Cloudflare), both using the SQL in schema.sql.

export type Plan = 'free' | 'premium';

/** Identity comes from Firebase Authentication (Google sign-in); `id` is the Firebase uid. */
export interface User {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  createdAt: string;
}

export interface AnswerRecord {
  questionId: string;
  examId: string;
  category: string;
  subject: string | null;
  selected: string;
  isCorrect: boolean;
  /** Time spent on the question, when the client measured it. */
  durationMs?: number | null;
}

export interface SimuladoRecord {
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
  /** 0–100, rounded; 0 when nothing has been answered. */
  accuracy: number;
  /** Consecutive days with at least one answer, ending today (or yesterday). */
  streakDays: number;
  bySubject: SubjectStats[];
}

export interface SubjectStats {
  subject: string;
  answered: number;
  correct: number;
  /** Distinct questions answered at least once (for "Seu progresso"). */
  questions: number;
}

export interface PeriodTotals {
  answered: number;
  correct: number;
  /** Mean time per question in seconds; null when no timed answers. */
  avgSeconds: number | null;
}

/** The "Estatísticas" page: the last `days` days against the `days` before them. */
export interface ActivityStats {
  days: { day: string; correct: number; wrong: number }[];
  current: PeriodTotals;
  previous: PeriodTotals;
  bySubject: SubjectStats[];
  /**
   * Accuracy rank among users with at least RANKING_MIN_ANSWERS answers in the
   * period; null when the user doesn't qualify or there are too few users.
   */
  ranking: { topPercent: number; users: number } | null;
}

export const RANKING_MIN_ANSWERS = 10;
export const RANKING_MIN_USERS = 5;

export interface ActivityOptions {
  days: number;
  category?: string;
  /** The browser's Date#getTimezoneOffset(), so days split at local midnight. */
  tzOffsetMinutes?: number;
  today?: Date;
}

export interface UserStore {
  /** Creates the user on first sign-in; afterwards keeps name/e-mail in sync with the Google account. */
  upsertUser(profile: { id: string; name: string; email: string }): Promise<User>;

  /** Records answers; when `simulado` is given they're grouped under one attempt. */
  recordAnswers(
    userId: string,
    answers: AnswerRecord[],
    simulado?: { category: string; title: string },
  ): Promise<SimuladoRecord | undefined>;

  getStats(userId: string, options?: { category?: string; today?: Date }): Promise<UserStats>;
  listSimulados(userId: string, options?: { category?: string; limit?: number }): Promise<SimuladoRecord[]>;
  getActivity(userId: string, options: ActivityOptions): Promise<ActivityStats>;
  /** Removes the profile with all its answers and simulados. */
  deleteUser(userId: string): Promise<void>;
}

/** YYYY-MM-DD in UTC, matching SQLite's date(). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `days` must be distinct YYYY-MM-DD strings, newest first. */
export function countStreak(days: string[], today: Date): number {
  const cursor = new Date(`${isoDay(today)}T00:00:00Z`);
  // Not having practiced yet today doesn't break yesterday's streak.
  if (days[0] !== isoDay(cursor)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  for (const day of days) {
    if (day !== isoDay(cursor)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
