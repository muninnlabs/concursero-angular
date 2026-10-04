import {
  countStreak,
  isoDay,
  RANKING_MIN_ANSWERS,
  RANKING_TOP,
  type ProfileStats,
  RANKING_MIN_USERS,
  type ActivityOptions,
  type ActivityStats,
  type PeriodTotals,
  type SubjectStats,
  type AnswerRecord,
  type Plan,
  type SimuladoRecord,
  type User,
  type UserStats,
  type UserStore,
} from './store.ts';
import { ANSWER_XP_SQL, PERFECT_MIN_QUESTIONS, SIMULADO_XP_SQL, publicName } from './profile.ts';

/** The few operations the store needs; implemented for node:sqlite and Cloudflare D1. */
export interface SqlDatabase {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Runs the statements atomically. */
  batch(statements: { sql: string; params: unknown[] }[]): Promise<void>;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  created_at: string;
  bio: string | null;
  location: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    createdAt: row.created_at,
    bio: row.bio ?? null,
    location: row.location ?? null,
  };
}

export class SqlUserStore implements UserStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async upsertUser(profile: { id: string; name: string; email: string }): Promise<User> {
    await this.db.batch([
      {
        sql: `INSERT INTO users (id, name, email, plan, created_at) VALUES (?, ?, ?, 'free', ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`,
        params: [profile.id, profile.name, profile.email.toLowerCase(), new Date().toISOString()],
      },
    ]);
    const row = await this.db.first<UserRow>('SELECT * FROM users WHERE id = ?', [profile.id]);
    return toUser(row!);
  }

  async updateProfile(userId: string, fields: { bio?: string | null; location?: string | null }): Promise<User | undefined> {
    const sets = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (sets.length) {
      await this.db.batch([
        {
          sql: `UPDATE users SET ${sets.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
          params: [...sets.map(([, value]) => value), userId],
        },
      ]);
    }
    const row = await this.db.first<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
    return row && toUser(row);
  }

  async getProfile(userId: string, options: { tzOffsetMinutes?: number; now?: Date } = {}): Promise<ProfileStats> {
    const toLocal = `${-(options.tzOffsetMinutes ?? 0)} minutes`;
    const now = options.now ?? new Date();

    const answers = await this.db.first<{ answered: number; xp: number }>(
      `SELECT COUNT(*) AS answered, COALESCE(SUM(${ANSWER_XP_SQL}), 0) AS xp FROM answers WHERE user_id = ?`,
      [userId],
    );
    const simulados = await this.db.first<{ count: number; perfect: number; xp: number }>(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(correct = total AND total >= ${PERFECT_MIN_QUESTIONS}), 0) AS perfect,
              COALESCE(SUM(${SIMULADO_XP_SQL}), 0) AS xp
       FROM simulados WHERE user_id = ?`,
      [userId],
    );
    const days = await this.db.all<{ day: string; count: number }>(
      `SELECT date(answered_at, ?) AS day, COUNT(*) AS count FROM answers WHERE user_id = ?
       GROUP BY day ORDER BY day DESC`,
      [toLocal, userId],
    );

    // Rolling week, the same instant for everyone whatever their time zone.
    const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const ranked = `
      WITH weekly AS (
        SELECT user_id, ${ANSWER_XP_SQL} AS xp FROM answers WHERE answered_at >= ?
        UNION ALL
        SELECT user_id, ${SIMULADO_XP_SQL} AS xp FROM simulados WHERE finished_at >= ?
      ),
      ranked AS (
        SELECT w.user_id AS id, u.name AS name, SUM(w.xp) AS xp,
               ROW_NUMBER() OVER (ORDER BY SUM(w.xp) DESC, MIN(u.created_at)) AS position
        FROM weekly w JOIN users u ON u.id = w.user_id
        GROUP BY w.user_id
      )`;
    const rows = await this.db.all<{ id: string; name: string; xp: number; position: number }>(
      `${ranked}
       SELECT id, name, xp, position FROM ranked
       WHERE position <= ? OR ABS(position - COALESCE((SELECT position FROM ranked WHERE id = ?), -99)) <= 1
       ORDER BY position`,
      [since, since, RANKING_TOP, userId],
    );
    const total = await this.db.first<{ users: number }>(`${ranked} SELECT COUNT(*) AS users FROM ranked`, [since, since]);

    return {
      xp: (answers?.xp ?? 0) + (simulados?.xp ?? 0),
      answered: answers?.answered ?? 0,
      simulados: simulados?.count ?? 0,
      perfectSimulados: simulados?.perfect ?? 0,
      days,
      bySubject: await this.subjectStats('user_id = ?', [userId]),
      weeklyRanking: rows.map((r) => ({
        position: r.position,
        name: r.id === userId ? r.name : publicName(r.name),
        xp: r.xp,
        you: r.id === userId,
      })),
      weeklyUsers: total?.users ?? 0,
    };
  }

  async recordAnswers(
    userId: string,
    answers: AnswerRecord[],
    simulado?: { category: string; title: string },
  ): Promise<SimuladoRecord | undefined> {
    const now = new Date().toISOString();
    const statements: { sql: string; params: unknown[] }[] = [];
    let record: SimuladoRecord | undefined;

    if (simulado) {
      record = {
        id: crypto.randomUUID(),
        category: simulado.category,
        title: simulado.title,
        total: answers.length,
        correct: answers.filter((a) => a.isCorrect).length,
        finishedAt: now,
      };
      statements.push({
        sql: 'INSERT INTO simulados (id, user_id, category, title, total, correct, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [record.id, userId, record.category, record.title, record.total, record.correct, now],
      });
    }
    for (const a of answers) {
      statements.push({
        sql: `INSERT INTO answers (user_id, simulado_id, question_id, exam_id, category, subject, selected, is_correct, answered_at, duration_ms)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          userId,
          record?.id ?? null,
          a.questionId,
          a.examId,
          a.category,
          a.subject,
          a.selected,
          a.isCorrect ? 1 : 0,
          now,
          a.durationMs ?? null,
        ],
      });
    }
    await this.db.batch(statements);
    return record;
  }

  async getStats(userId: string, options: { category?: string; today?: Date } = {}): Promise<UserStats> {
    const where = options.category ? 'user_id = ? AND category = ?' : 'user_id = ?';
    const params = options.category ? [userId, options.category] : [userId];

    const totals = await this.db.first<{ answered: number; correct: number }>(
      `SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct), 0) AS correct FROM answers WHERE ${where}`,
      params,
    );
    const bySubject = await this.subjectStats(where, params);
    // The streak counts activity in any category: it's about showing up daily.
    const days = await this.db.all<{ day: string }>(
      'SELECT DISTINCT date(answered_at) AS day FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 400',
      [userId],
    );

    const answered = totals?.answered ?? 0;
    const correct = totals?.correct ?? 0;
    return {
      answered,
      correct,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
      streakDays: countStreak(
        days.map((d) => d.day),
        options.today ?? new Date(),
      ),
      bySubject,
    };
  }

  async listSimulados(userId: string, options: { category?: string; limit?: number } = {}): Promise<SimuladoRecord[]> {
    const where = options.category ? 'user_id = ? AND category = ?' : 'user_id = ?';
    const params = options.category ? [userId, options.category] : [userId];
    return this.db.all<SimuladoRecord>(
      `SELECT id, category, title, total, correct, finished_at AS finishedAt FROM simulados
       WHERE ${where} ORDER BY finished_at DESC LIMIT ?`,
      [...params, options.limit ?? 10],
    );
  }

  async getActivity(userId: string, options: ActivityOptions): Promise<ActivityStats> {
    const offset = options.tzOffsetMinutes ?? 0;
    // SQLite date() modifier that turns the stored UTC time into the user's local time.
    const toLocal = `${-offset} minutes`;
    const localToday = new Date((options.today ?? new Date()).getTime() - offset * 60_000);
    const dayOffset = (n: number) => {
      const d = new Date(`${isoDay(localToday)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return isoDay(d);
    };
    const start = dayOffset(-(options.days - 1));
    const previousStart = dayOffset(-(2 * options.days - 1));

    const categoryFilter = options.category ? ' AND category = ?' : '';
    const categoryParams = options.category ? [options.category] : [];
    const inPeriod = `user_id = ? AND date(answered_at, ?) >= ?${categoryFilter}`;
    const periodParams = [userId, toLocal, start, ...categoryParams];

    const totals = async (where: string, params: unknown[]): Promise<PeriodTotals> => {
      const row = await this.db.first<{ answered: number; correct: number; avgMs: number | null }>(
        `SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct), 0) AS correct, AVG(duration_ms) AS avgMs
         FROM answers WHERE ${where}`,
        params,
      );
      return {
        answered: row?.answered ?? 0,
        correct: row?.correct ?? 0,
        avgSeconds: row?.avgMs == null ? null : Math.round(row.avgMs / 1000),
      };
    };

    const daily = await this.db.all<{ day: string; correct: number; answered: number }>(
      `SELECT date(answered_at, ?) AS day, SUM(is_correct) AS correct, COUNT(*) AS answered
       FROM answers WHERE ${inPeriod} GROUP BY day`,
      [toLocal, ...periodParams],
    );
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const days = Array.from({ length: options.days }, (_, i) => {
      const day = dayOffset(i - (options.days - 1));
      const row = byDay.get(day);
      return { day, correct: row?.correct ?? 0, wrong: (row?.answered ?? 0) - (row?.correct ?? 0) };
    });

    const current = await totals(inPeriod, periodParams);
    const previous = await totals(
      `user_id = ? AND date(answered_at, ?) >= ? AND date(answered_at, ?) < ?${categoryFilter}`,
      [userId, toLocal, previousStart, toLocal, start, ...categoryParams],
    );

    const rank = await this.db.first<{ users: number; better: number | null; mine: number | null }>(
      `WITH per AS (
         SELECT user_id, AVG(is_correct) AS accuracy FROM answers
         WHERE date(answered_at, ?) >= ?${categoryFilter}
         GROUP BY user_id HAVING COUNT(*) >= ?
       )
       SELECT COUNT(*) AS users,
              SUM(accuracy > (SELECT accuracy FROM per WHERE user_id = ?)) AS better,
              (SELECT accuracy FROM per WHERE user_id = ?) AS mine
       FROM per`,
      [toLocal, start, ...categoryParams, RANKING_MIN_ANSWERS, userId, userId],
    );
    const ranking =
      rank && rank.mine != null && rank.users >= RANKING_MIN_USERS
        ? { topPercent: Math.max(1, Math.ceil((((rank.better ?? 0) + 1) / rank.users) * 100)), users: rank.users }
        : null;

    return {
      days,
      current,
      previous,
      bySubject: await this.subjectStats(inPeriod, periodParams),
      ranking,
    };
  }

  async deleteUser(userId: string): Promise<void> {
    // Explicit deletes rather than relying on ON DELETE CASCADE being enabled.
    await this.db.batch(
      ['DELETE FROM answers WHERE user_id = ?', 'DELETE FROM simulados WHERE user_id = ?', 'DELETE FROM users WHERE id = ?'].map(
        (sql) => ({ sql, params: [userId] }),
      ),
    );
  }

  private subjectStats(where: string, params: unknown[]): Promise<SubjectStats[]> {
    return this.db.all<SubjectStats>(
      `SELECT subject, COUNT(*) AS answered, SUM(is_correct) AS correct, COUNT(DISTINCT question_id) AS questions
       FROM answers WHERE ${where} AND subject IS NOT NULL GROUP BY subject ORDER BY answered DESC`,
      params,
    );
  }
}
