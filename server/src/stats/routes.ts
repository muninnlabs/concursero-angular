import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest, type TokenService } from '../auth/auth.ts';
import { isGradable, type ExamCatalog } from '../exams/catalog.ts';
import type { AnswerRecord, UserStore } from '../users/store.ts';

const MAX_ANSWERS_PER_REQUEST = 200;

interface SubmittedAnswer {
  questionId: string;
  selected: string;
}

export function statsRoutes(catalog: ExamCatalog, store: UserStore, tokens: TokenService): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  /**
   * Grades answers against the answer key and records them.
   * Body: { answers: [{ questionId, selected }], simulado?: { title } }
   * With `simulado`, the answers are saved as one attempt (shown in "Últimos Simulados").
   */
  router.post('/answers', async (req: AuthenticatedRequest, res) => {
    const submitted: SubmittedAnswer[] = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (submitted.length === 0 || submitted.length > MAX_ANSWERS_PER_REQUEST) {
      res.status(400).json({ error: `Envie entre 1 e ${MAX_ANSWERS_PER_REQUEST} respostas.` });
      return;
    }

    const records: AnswerRecord[] = [];
    for (const answer of submitted) {
      const found = catalog.getQuestion(String(answer?.questionId));
      const selected = String(answer?.selected ?? '').toUpperCase();
      if (!found || !isGradable(found.question) || !found.question.options.some((o) => o.letter === selected)) {
        res.status(400).json({ error: `Resposta inválida para a questão ${answer?.questionId}` });
        return;
      }
      records.push({
        questionId: found.question.id,
        examId: found.exam.id,
        category: found.exam.category,
        subject: found.question.subject,
        selected,
        isCorrect: selected === found.question.correct_answer,
      });
    }

    let simulado;
    if (req.body?.simulado) {
      const categories = new Set(records.map((r) => r.category));
      const category = categories.size === 1 ? records[0].category : 'Misto';
      const title = String(req.body.simulado.title ?? '').trim() || `Simulado ${category}`;
      simulado = { category, title: title.slice(0, 120) };
    }

    const saved = await store.recordAnswers(req.userId!, records, simulado);
    res.status(201).json({
      results: records.map((r) => ({
        questionId: r.questionId,
        selected: r.selected,
        isCorrect: r.isCorrect,
        correctAnswer: catalog.getQuestion(r.questionId)!.question.correct_answer,
      })),
      simulado: saved,
    });
  });

  router.get('/me/stats', async (req: AuthenticatedRequest, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json(await store.getStats(req.userId!, { category }));
  });

  router.get('/me/simulados', async (req: AuthenticatedRequest, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);
    res.json(await store.listSimulados(req.userId!, { category, limit }));
  });

  return router;
}
