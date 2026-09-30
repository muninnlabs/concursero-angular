-- Time spent on each question (ms), for "Média por Questão". Null for answers
-- recorded before this column existed.
ALTER TABLE answers ADD COLUMN duration_ms INTEGER;
