// Everything the app persists lives behind this interface. Exams themselves are
// never stored here: they're read from the JSON files by ExamCatalog.
// The SQLite implementation is for development / small deployments; a Postgres
// or Firestore implementation only has to satisfy this contract.

export type Plan = 'free' | 'premium';

export interface User {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  createdAt: string;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

export interface AnswerRecord {
  questionId: string;
  examId: string;
  category: string;
  subject: string | null;
  selected: string;
  isCorrect: boolean;
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
  bySubject: { subject: string; answered: number; correct: number }[];
}

export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
  }
}

export interface UserStore {
  createUser(input: { name: string; email: string; passwordHash: string }): Promise<User>;
  findUserByEmail(email: string): Promise<UserWithPassword | undefined>;
  findUserById(id: string): Promise<User | undefined>;

  /** Records answers; when `simulado` is given they're grouped under one attempt. */
  recordAnswers(
    userId: string,
    answers: AnswerRecord[],
    simulado?: { category: string; title: string },
  ): Promise<SimuladoRecord | undefined>;

  getStats(userId: string, options?: { category?: string; today?: Date }): Promise<UserStats>;
  listSimulados(userId: string, options?: { category?: string; limit?: number }): Promise<SimuladoRecord[]>;
}
