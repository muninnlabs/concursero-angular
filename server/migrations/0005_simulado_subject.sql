-- Subject of a subject-focused Mini Simulado ("Mini Simulado — Direito do
-- Trabalho"), so "Últimos Simulados" can retry the same subject. Null when the
-- simulado mixed subjects.
ALTER TABLE simulados ADD COLUMN subject TEXT;

-- Older ones: the subject is in the title, and every answer has it.
UPDATE simulados
SET subject = (SELECT MIN(a.subject) FROM answers a WHERE a.simulado_id = simulados.id)
WHERE title = 'Mini Simulado — ' || (SELECT MIN(a.subject) FROM answers a WHERE a.simulado_id = simulados.id)
  AND (SELECT COUNT(DISTINCT a.subject) FROM answers a WHERE a.simulado_id = simulados.id) = 1;
