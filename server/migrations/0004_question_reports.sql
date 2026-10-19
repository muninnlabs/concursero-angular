-- Students flag questions that look wrong ("Reportar erro" on the practice page).
-- One row per user, question and reason; reporting the same thing again only
-- refreshes the comment. `status` is for whoever reviews them: open, fixed or dismissed.
CREATE TABLE IF NOT EXISTS question_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  exam_id     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  comment     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, question_id, reason)
);
CREATE INDEX IF NOT EXISTS question_reports_status ON question_reports(status, exam_id, question_id);

-- Questions to review, most reported first.
CREATE VIEW IF NOT EXISTS flagged_questions AS
SELECT exam_id, question_id, COUNT(*) AS reports, COUNT(DISTINCT user_id) AS users,
       GROUP_CONCAT(DISTINCT reason) AS reasons, MAX(created_at) AS last_reported_at
FROM question_reports WHERE status = 'open'
GROUP BY exam_id, question_id
ORDER BY users DESC, last_reported_at DESC;
