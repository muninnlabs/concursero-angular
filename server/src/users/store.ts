// Everything the app persists lives behind this interface. Exams themselves are
// never stored here: they're read from the JSON files by an ExamSource.
// Implementations: SqliteUserStore (Node, local development) and D1UserStore
// (Cloudflare), both using the SQL in schema.sql.

export type Plan = 'free' | 'premium';

/** Accounts treated as Premium whatever their stored plan, until payments exist. */
const PREMIUM_EMAILS = new Set(['alexandreartedesigner@gmail.com']);

/** Days of Premium every new account starts with. */
export const TRIAL_DAYS = 7;

/** Statuses that still give Premium (past_due: Stripe is retrying the card). */
const LIVE_SUBSCRIPTION = ['active', 'trialing', 'past_due'];
/** A renewal's webhook can lag the end of the period a little. */
const SUBSCRIPTION_GRACE_MS = 2 * 86_400_000;

/**
 * Premium comes from a redeem code (stored plan, until `premiumUntil` or for good
 * when it's null) or from a live Stripe subscription.
 */
export function planFor(
  email: string,
  stored: Plan,
  premiumUntil: string | null = null,
  now = new Date(),
  subscription: { status: string; periodEnd: string } | null = null,
): Plan {
  if (PREMIUM_EMAILS.has(email.toLowerCase())) return 'premium';
  if (stored === 'premium' && (!premiumUntil || premiumUntil > now.toISOString())) return 'premium';
  const live = subscription && LIVE_SUBSCRIPTION.includes(subscription.status);
  return live && Date.parse(subscription.periodEnd) + SUBSCRIPTION_GRACE_MS > now.getTime() ? 'premium' : 'free';
}

/** Mirrors the Stripe subscription (see billing/stripe.ts). */
export interface Subscription {
  status: string;
  /** End of the paid period (ISO). */
  periodEnd: string;
  /** False once cancelled: it ends at periodEnd. */
  renews: boolean;
}

/** Codes are shown as XXXX-XXXX-XXXX; case, spaces and dashes don't matter when typed. */
export function normalizeCode(input: string): string {
  const plain = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return plain.match(/.{1,4}/g)?.join('-') ?? '';
}

export type RedeemResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid' | 'used' | 'exhausted' | 'lifetime' };

/** Identity comes from Firebase Authentication (Google sign-in); `id` is the Firebase uid. */
export interface User {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  /** When Premium from a redeem code ends (ISO); null when it doesn't or there is none. */
  premiumUntil: string | null;
  /** The Stripe subscription, live or past; null when the user never subscribed. */
  subscription: Subscription | null;
  createdAt: string;
  /** Set by the user on the profile page. */
  bio: string | null;
  location: string | null;
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

/** Why a student flags a question; the labels live in the client's report dialog. */
export const REPORT_REASONS = [
  'wrong_answer',
  'missing_image',
  'missing_text',
  'wrong_text',
  'wrong_options',
  'wrong_subject',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface QuestionReport {
  questionId: string;
  examId: string;
  reason: ReportReason;
  comment: string | null;
}

export interface SimuladoRecord {
  id: string;
  category: string;
  title: string;
  /** Set when every question was from this subject (retry asks for the same one). */
  subject: string | null;
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

/** Raw numbers behind the student profile; rules (levels, badges) live in profile.ts. */
export interface ProfileStats {
  xp: number;
  answered: number;
  simulados: number;
  perfectSimulados: number;
  /** Every local day with answers, newest first. */
  days: { day: string; count: number }[];
  /** All time. */
  bySubject: SubjectStats[];
  /** XP earned in the last 7 × 24 h: the top 10 plus the user and their neighbours. */
  weeklyRanking: { position: number; name: string; xp: number; you: boolean }[];
  weeklyUsers: number;
}

/** Raw numbers behind "Análise Avançada" (Premium); grouping by exam year, institution and part of day happens in app.ts. */
export interface InsightStats {
  totals: PeriodTotals;
  /** Mean seconds on questions answered right / wrong; null without timed answers. */
  timing: { correct: number | null; wrong: number | null };
  bySubject: { subject: string; answered: number; correct: number; avgSeconds: number | null }[];
  byExam: { examId: string; answered: number; correct: number }[];
  /** Local hour 0–23. */
  byHour: { hour: number; answered: number; correct: number }[];
  /** The last INSIGHT_WEEKS weeks (whatever the period), oldest first; `start` is the local Monday. */
  weekly: { start: string; answered: number; correct: number }[];
}

export const INSIGHT_WEEKS = 12;

export interface InsightOptions {
  /** Last `days` local days; null for all time. */
  days: number | null;
  category?: string;
  tzOffsetMinutes?: number;
  today?: Date;
}

export const RANKING_TOP = 10;

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
    simulado?: { category: string; title: string; subject?: string | null },
  ): Promise<SimuladoRecord | undefined>;

  getStats(userId: string, options?: { category?: string; today?: Date }): Promise<UserStats>;
  listSimulados(userId: string, options?: { category?: string; limit?: number }): Promise<SimuladoRecord[]>;
  getActivity(userId: string, options: ActivityOptions): Promise<ActivityStats>;
  getInsights(userId: string, options: InsightOptions): Promise<InsightStats>;
  getProfile(userId: string, options: { tzOffsetMinutes?: number; now?: Date }): Promise<ProfileStats>;
  updateProfile(userId: string, fields: { bio?: string | null; location?: string | null }): Promise<User | undefined>;
  /** Flags a question for review; the same user, question and reason only refreshes the comment. */
  reportQuestion(userId: string, report: QuestionReport): Promise<void>;
  /** Adds codes (scripts/redeem-codes.mjs writes the same INSERT for D1). */
  createRedeemCodes(codes: { code: string; days: number | null; maxUses?: number; expiresAt?: string | null; note?: string | null }[]): Promise<void>;
  /** Gives the Premium days of a redeem code (see migrations/0006_redeem_codes.sql). */
  redeemCode(userId: string, code: string, now?: Date): Promise<RedeemResult>;
  /** The user's Stripe customer, once they've started a checkout. */
  billingCustomer(userId: string): Promise<string | null>;
  setBillingCustomer(userId: string, customerId: string): Promise<void>;
  /** Stores what Stripe says about the customer's subscription; undefined when no user has that customer. */
  updateSubscription(customerId: string, subscription: Subscription | null): Promise<User | undefined>;
  /** Removes the profile with all its answers, simulados and reports. */
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
