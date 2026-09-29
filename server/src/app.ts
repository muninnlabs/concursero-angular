import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthUser, TokenVerifier } from './auth/firebase.ts';
import { isPlayable, randomQuestions, toPublicQuestion, type ExamSource } from './exams/catalog.ts';
import type { AnswerRecord, UserStore } from './users/store.ts';

export interface AppDeps {
  exams: ExamSource;
  store: UserStore;
  verifyToken: TokenVerifier;
}

type Env = { Variables: { user: AuthUser } };

const MAX_PRACTICE_QUESTIONS = 50;
const MAX_ANSWERS_PER_REQUEST = 200;

/**
 * The API, independent of where it runs: server/src/node.ts serves it with
 * Node (local development), server/src/worker.ts on Cloudflare Workers.
 * All routes live under /api.
 */
export function createApp({ exams, store, verifyToken }: AppDeps) {
  const app = new Hono<Env>().basePath('/api');

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const user = header.startsWith('Bearer ') ? await verifyToken(header.slice(7)) : undefined;
    if (!user) return c.json({ error: 'Não autenticado' }, 401);
    c.set('user', user);
    await next();
  };

  app.get('/health', (c) => c.json({ ok: true }));

  // --- Exams (public) -----------------------------------------------------

  /** Totals for the landing page and the category chips on the dashboard. */
  app.get('/catalog', async (c) => {
    const list = await exams.list();
    const categories = [...new Set(list.map((e) => e.category))].map((category) => {
      const inCategory = list.filter((e) => e.category === category);
      return {
        category,
        examCount: inCategory.length,
        questionCount: inCategory.reduce((sum, e) => sum + e.questionCount, 0),
      };
    });
    return c.json({ totalQuestions: list.reduce((sum, e) => sum + e.questionCount, 0), categories });
  });

  app.get('/exams', async (c) => {
    const category = c.req.query('category');
    return c.json((await exams.list()).filter((e) => !category || e.category === category));
  });

  app.get('/exams/:examId', async (c) => {
    const exam = await exams.get(c.req.param('examId'));
    if (!exam) return c.json({ error: 'Prova não encontrada' }, 404);
    return c.json({ exam: exam.summary, questions: exam.questions.map((q) => toPublicQuestion(q, exam.summary.id)) });
  });

  /** Random questions for "Questão Relâmpago" (count=1) and "Mini Simulado" (count=10). */
  app.get('/practice/questions', async (c) => {
    const count = Math.min(Math.max(Number(c.req.query('count')) || 10, 1), MAX_PRACTICE_QUESTIONS);
    const picked = await randomQuestions(exams, count, {
      category: c.req.query('category') || undefined,
      subject: c.req.query('subject') || undefined,
    });
    return c.json(picked.map(({ question, exam }) => toPublicQuestion(question, exam.id)));
  });

  // --- Signed-in user -----------------------------------------------------

  /** Creates the profile on first sign-in and returns it. */
  app.get('/auth/me', requireAuth, async (c) => {
    const { uid, name, email } = c.get('user');
    return c.json(await store.upsertUser({ id: uid, name, email }));
  });

  /**
   * Grades answers against the answer key and records them.
   * Body: { answers: [{ questionId, examId, selected }], simulado?: { title } }
   * With `simulado`, the answers are saved as one attempt (shown in "Últimos Simulados").
   */
  app.post('/answers', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const submitted: { questionId?: unknown; examId?: unknown; selected?: unknown }[] = Array.isArray(body?.answers)
      ? body.answers
      : [];
    if (submitted.length === 0 || submitted.length > MAX_ANSWERS_PER_REQUEST) {
      return c.json({ error: `Envie entre 1 e ${MAX_ANSWERS_PER_REQUEST} respostas.` }, 400);
    }

    const user = c.get('user');
    const records: (AnswerRecord & { correctAnswer: string })[] = [];
    for (const answer of submitted) {
      const exam = await exams.get(String(answer?.examId));
      const question = exam?.questions.find((q) => q.id === String(answer?.questionId));
      const selected = String(answer?.selected ?? '').toUpperCase();
      if (!exam || !question || !isPlayable(question) || !question.options.some((o) => o.letter === selected)) {
        return c.json({ error: `Resposta inválida para a questão ${String(answer?.questionId)}` }, 400);
      }
      records.push({
        questionId: question.id,
        examId: exam.summary.id,
        category: exam.summary.category,
        subject: question.subject,
        selected,
        isCorrect: selected === question.correct_answer,
        correctAnswer: question.correct_answer!,
      });
    }

    let simulado;
    if (body?.simulado) {
      const categories = new Set(records.map((r) => r.category));
      const category = categories.size === 1 ? records[0].category : 'Misto';
      const title = String(body.simulado.title ?? '').trim() || `Simulado ${category}`;
      simulado = { category, title: title.slice(0, 120) };
    }

    // Answers only count once the profile exists (first request may come before /auth/me).
    await store.upsertUser({ id: user.uid, name: user.name, email: user.email });
    const saved = await store.recordAnswers(
      user.uid,
      records.map(({ correctAnswer: _key, ...record }) => record),
      simulado,
    );
    return c.json(
      {
        results: records.map((r) => ({
          questionId: r.questionId,
          selected: r.selected,
          isCorrect: r.isCorrect,
          correctAnswer: r.correctAnswer,
        })),
        simulado: saved,
      },
      201,
    );
  });

  app.get('/me/stats', requireAuth, async (c) => {
    return c.json(await store.getStats(c.get('user').uid, { category: c.req.query('category') || undefined }));
  });

  app.get('/me/simulados', requireAuth, async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 5, 1), 50);
    return c.json(
      await store.listSimulados(c.get('user').uid, { category: c.req.query('category') || undefined, limit }),
    );
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Erro interno' }, 500);
  });

  return app;
}
