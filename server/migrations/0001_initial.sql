-- Shared by SqliteUserStore (Node) and D1 (Cloudflare: `wrangler d1 migrations apply`).
-- users.id is the Firebase Authentication uid.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL
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
