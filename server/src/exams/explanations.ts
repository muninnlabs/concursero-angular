import type { ExamFile } from './types.ts';

/** A comment written by scripts/explain-oab.mjs, kept in assets/explanations/<folder>.json by question id. */
export interface GeneratedExplanation {
  explanation: string;
  /** What changed in the law since the exam, if anything. */
  update_note: string | null;
  /** false when the model thinks the official key is wrong: held back until reviewed. */
  agrees_with_key: boolean;
  confidence: string;
  model: string;
  generated_at: string;
}

/** Fills in generated explanations; one the banca published (ACAFE) always wins. */
export function withExplanations(data: ExamFile, explanations: Record<string, GeneratedExplanation>): ExamFile {
  return {
    ...data,
    questions: data.questions.map((q) => {
      const generated = explanations[q.id];
      if (q.explanation || !generated?.agrees_with_key) return q;
      return { ...q, explanation: generated.explanation, explanation_note: generated.update_note, explanation_ai: true };
    }),
  };
}
