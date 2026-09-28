import {
  countStreak,
  type AnswerRecord,
  type Plan,
  type SimuladoRecord,
  type User,
  type UserStats,
  type UserStore,
} from './store.ts';

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
    return { id: row!.id, name: row!.name, email: row!.email, plan: row!.plan, createdAt: row!.created_at };
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
        sql: `INSERT INTO answers (user_id, simulado_id, question_id, exam_id, category, subject, selected, is_correct, answered_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [userId, record?.id ?? null, a.questionId, a.examId, a.category, a.subject, a.selected, a.isCorrect ? 1 : 0, now],
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
    const bySubject = await this.db.all<UserStats['bySubject'][number]>(
      `SELECT subject, COUNT(*) AS answered, SUM(is_correct) AS correct FROM answers
       WHERE ${where} AND subject IS NOT NULL GROUP BY subject ORDER BY answered DESC`,
      params,
    );
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
}
