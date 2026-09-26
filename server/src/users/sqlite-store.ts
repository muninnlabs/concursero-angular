import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EmailTakenError,
  type AnswerRecord,
  type Plan,
  type SimuladoRecord,
  type User,
  type UserStats,
  type UserStore,
  type UserWithPassword,
} from './store.ts';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'free',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS simulados (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    total       INTEGER NOT NULL,
    correct     INTEGER NOT NULL,
    finished_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS simulados_user ON simulados(user_id, finished_at);

  CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    simulado_id TEXT REFERENCES simulados(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    exam_id     TEXT NOT NULL,
    category    TEXT NOT NULL,
    subject     TEXT,
    selected    TEXT NOT NULL,
    is_correct  INTEGER NOT NULL,
    answered_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS answers_user ON answers(user_id, answered_at);
`;

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  plan: Plan;
  created_at: string;
}

function toUser(row: UserRow): UserWithPassword {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

function withoutPassword({ passwordHash: _hash, ...user }: UserWithPassword): User {
  return user;
}

/** YYYY-MM-DD in UTC, matching SQLite's date(). */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class SqliteUserStore implements UserStore {
  private readonly db: DatabaseSync;

  /** Pass ':memory:' for tests. */
  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  async createUser(input: { name: string; email: string; passwordHash: string }): Promise<User> {
    const user: UserWithPassword = {
      id: randomUUID(),
      name: input.name,
      email: input.email.toLowerCase(),
      plan: 'free',
      createdAt: new Date().toISOString(),
      passwordHash: input.passwordHash,
    };
    try {
      this.db
        .prepare(
          'INSERT INTO users (id, name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(user.id, user.name, user.email, user.passwordHash, user.plan, user.createdAt);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new EmailTakenError();
      throw error;
    }
    return withoutPassword(user);
  }

  async findUserByEmail(email: string): Promise<UserWithPassword | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    return row ? toUser(row as unknown as UserRow) : undefined;
  }

  async findUserById(id: string): Promise<User | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? withoutPassword(toUser(row as unknown as UserRow)) : undefined;
  }

  async recordAnswers(
    userId: string,
    answers: AnswerRecord[],
    simulado?: { category: string; title: string },
  ): Promise<SimuladoRecord | undefined> {
    const now = new Date().toISOString();
    let record: SimuladoRecord | undefined;

    this.db.exec('BEGIN');
    try {
      if (simulado) {
        record = {
          id: randomUUID(),
          category: simulado.category,
          title: simulado.title,
          total: answers.length,
          correct: answers.filter((a) => a.isCorrect).length,
          finishedAt: now,
        };
        this.db
          .prepare(
            'INSERT INTO simulados (id, user_id, category, title, total, correct, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(record.id, userId, record.category, record.title, record.total, record.correct, now);
      }
      const insert = this.db.prepare(
        `INSERT INTO answers (user_id, simulado_id, question_id, exam_id, category, subject, selected, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of answers) {
        insert.run(userId, record?.id ?? null, a.questionId, a.examId, a.category, a.subject, a.selected, a.isCorrect ? 1 : 0, now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return record;
  }

  async getStats(userId: string, options: { category?: string; today?: Date } = {}): Promise<UserStats> {
    const where = options.category ? 'user_id = ? AND category = ?' : 'user_id = ?';
    const params = options.category ? [userId, options.category] : [userId];

    const totals = this.db
      .prepare(`SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct), 0) AS correct FROM answers WHERE ${where}`)
      .get(...params) as { answered: number; correct: number };

    const bySubject = this.db
      .prepare(
        `SELECT subject, COUNT(*) AS answered, SUM(is_correct) AS correct FROM answers
         WHERE ${where} AND subject IS NOT NULL GROUP BY subject ORDER BY answered DESC`,
      )
      .all(...params) as unknown as UserStats['bySubject'];

    // The streak counts activity in any category: it's about showing up daily.
    const days = this.db
      .prepare('SELECT DISTINCT date(answered_at) AS day FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 400')
      .all(userId) as { day: string }[];

    return {
      answered: totals.answered,
      correct: totals.correct,
      accuracy: totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0,
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
    return this.db
      .prepare(
        `SELECT id, category, title, total, correct, finished_at AS finishedAt FROM simulados
         WHERE ${where} ORDER BY finished_at DESC LIMIT ?`,
      )
      .all(...params, options.limit ?? 10) as unknown as SimuladoRecord[];
  }
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
