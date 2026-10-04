import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthUser, TokenVerifier } from './auth/firebase.ts';
import { isPlayable, randomQuestions, toPublicQuestion, type ExamSource } from './exams/catalog.ts';
import { badgesFor, levelFor, longestStreak } from './users/profile.ts';
import { countStreak, isoDay, type AnswerRecord, type UserStore } from './users/store.ts';

export interface AppDeps {
  exams: ExamSource;
  store: UserStore;
  verifyToken: TokenVerifier;
}

type Env = { Variables: { user: AuthUser } };

const MAX_PRACTICE_QUESTIONS = 50;
const MAX_ANSWERS_PER_REQUEST = 200;
/** Longer than this, the tab was probably left open: the time isn't counted. */
const MAX_DURATION_MS = 30 * 60_000;
const ACTIVITY_PERIODS = [7, 30];
/** Days of history in the profile's activity grid (26 weeks). */
const HEATMAP_DAYS = 182;
const MAX_BIO = 280;
const MAX_LOCATION = 60;

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

  /** Subjects with their practisable question counts, most questions first ("Assuntos"). */
  app.get('/subjects', async (c) => {
    const category = c.req.query('category');
    const totals = new Map<string, { subject: string; category: string; questionCount: number; examCount: number }>();
    for (const exam of await exams.list()) {
      if (category && exam.category !== category) continue;
      for (const [subject, count] of Object.entries(exam.subjectCounts)) {
        const key = `${exam.category}\u0000${subject}`;
        const entry = totals.get(key) ?? { subject, category: exam.category, questionCount: 0, examCount: 0 };
        entry.questionCount += count;
        entry.examCount++;
        totals.set(key, entry);
      }
    }
    return c.json([...totals.values()].sort((a, b) => b.questionCount - a.questionCount));
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
    const submitted: { questionId?: unknown; examId?: unknown; selected?: unknown; durationMs?: unknown }[] = Array.isArray(
      body?.answers,
    )
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
        durationMs: validDuration(answer?.durationMs),
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

  /** "Estatísticas": ?days=7|30&category=OAB&tz=<Date#getTimezoneOffset()> */
  app.get('/me/activity', requireAuth, async (c) => {
    const days = Number(c.req.query('days'));
    return c.json(
      await store.getActivity(c.get('user').uid, {
        days: ACTIVITY_PERIODS.includes(days) ? days : 7,
        category: c.req.query('category') || undefined,
        tzOffsetMinutes: timezoneOffset(c.req.query('tz')),
      }),
    );
  });

  /** "Seu perfil de estudante": XP, level, streaks, badges, activity grid and the weekly ranking. ?tz=<Date#getTimezoneOffset()> */
  app.get('/me/profile', requireAuth, async (c) => {
    const { uid, name, email } = c.get('user');
    const tzOffsetMinutes = timezoneOffset(c.req.query('tz'));
    const user = await store.upsertUser({ id: uid, name, email });
    const stats = await store.getProfile(uid, { tzOffsetMinutes });

    const localToday = new Date(Date.now() - tzOffsetMinutes * 60_000);
    const dayList = stats.days.map((d) => d.day);
    const firstDay = new Date(`${isoDay(localToday)}T00:00:00Z`);
    firstDay.setUTCDate(firstDay.getUTCDate() - (HEATMAP_DAYS - 1));
    const streak = { current: countStreak(dayList, localToday), longest: longestStreak(dayList) };

    return c.json({
      user,
      xp: stats.xp,
      level: levelFor(stats.xp),
      streak: { ...streak, practicedToday: dayList[0] === isoDay(localToday) },
      today: isoDay(localToday),
      activity: stats.days.filter((d) => d.day >= isoDay(firstDay)),
      badges: badgesFor({
        answered: stats.answered,
        longestStreak: streak.longest,
        simulados: stats.simulados,
        perfectSimulados: stats.perfectSimulados,
        bySubject: stats.bySubject,
      }),
      ranking: { entries: stats.weeklyRanking, users: stats.weeklyUsers },
    });
  });

  /** Body: { bio?, location? } (null or "" clears). */
  app.patch('/me', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const field = (value: unknown, max: number): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const text = String(value).trim().slice(0, max);
      return text || null;
    };
    const { uid, name, email } = c.get('user');
    await store.upsertUser({ id: uid, name, email });
    const user = await store.updateProfile(uid, {
      bio: field(body?.bio, MAX_BIO),
      location: field(body?.location, MAX_LOCATION),
    });
    return c.json(user);
  });

  /** Deletes the profile, answers and simulados. The Firebase account itself is left alone (shared with the mobile app). */
  app.delete('/me', requireAuth, async (c) => {
    await store.deleteUser(c.get('user').uid);
    return c.body(null, 204);
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

function validDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DURATION_MS
    ? Math.round(value)
    : null;
}

/** Date#getTimezoneOffset() from the browser, e.g. 180 for Brasília; 0 when missing or implausible. */
function timezoneOffset(value: string | undefined): number {
  const tz = Number(value);
  return Number.isInteger(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
}
