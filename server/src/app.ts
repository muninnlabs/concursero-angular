import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthUser, TokenVerifier } from './auth/firebase.ts';
import { LIVE_STATUSES, type Billing } from './billing/stripe.ts';
import { isPlayable, randomQuestions, toPublicQuestion, type ExamSource } from './exams/catalog.ts';
import { AD_PLACEMENTS, addDays, brasiliaDay, type AdPlacementId, type SiteStore } from './site/site-store.ts';
import { deviceOf, geoOf, isBot, referrerHost, text } from './site/visitor.ts';
import { generateCode } from './users/codes.ts';
import type { ConcursoInfo } from './exams/types.ts';
import { badgesFor, levelFor, longestStreak } from './users/profile.ts';
import { countStreak, isoDay, REPORT_REASONS, normalizeCode, type AnswerRecord, type ReportReason, type UserStore } from './users/store.ts';

export interface AppDeps {
  exams: ExamSource;
  store: UserStore;
  verifyToken: TokenVerifier;
  /** Stripe; without it the payment routes answer 503. */
  billing?: Billing;
  /** Page views, ads and the admin panel; without it tracking is skipped and /admin answers 503. */
  site?: SiteStore;
  /** Public address of the app (Stripe sends the user back there), e.g. https://concursero.com */
  appUrl?: string;
}

type Env = { Variables: { user: AuthUser } };

/** Google accounts that open the admin panel (/app/admin). */
const ADMIN_EMAILS = new Set(['alex.munninlabs@gmail.com', 'alexandreartedesigner@gmail.com']);
const REPORT_PERIODS = [7, 30, 90, 365];
const MAX_AD_IMAGE_BYTES = 500_000;
const AD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_CODES_PER_REQUEST = 500;

const MAX_PRACTICE_QUESTIONS = 50;
const MAX_ANSWERS_PER_REQUEST = 200;
/** Longer than this, the tab was probably left open: the time isn't counted. */
const MAX_DURATION_MS = 30 * 60_000;
const ACTIVITY_PERIODS = [7, 30];
/** "Análise Avançada": 0 means all time. */
const INSIGHT_PERIODS = [30, 90, 0];
/** Fewer answers than this in a subject say little about it ("Pontos a melhorar"). */
const MIN_ANSWERS_WEAK_SUBJECT = 5;
const WEAKEST_SUBJECTS = 5;
/** Local hours [from, to) for "Melhor horário". */
const DAY_PARTS = [
  { id: 'madrugada', from: 0, to: 6 },
  { id: 'manha', from: 6, to: 12 },
  { id: 'tarde', from: 12, to: 18 },
  { id: 'noite', from: 18, to: 24 },
] as const;
/** Days of history in the profile's activity grid (26 weeks). */
const HEATMAP_DAYS = 182;
const MAX_BIO = 280;
const MAX_LOCATION = 60;
const MAX_REPORT_COMMENT = 500;
const REDEEM_ERRORS = {
  invalid: 'Código inválido ou expirado.',
  used: 'Você já usou este código.',
  exhausted: 'Este código já foi usado.',
  lifetime: 'Sua conta já é Premium sem data de término.',
} as const;

/**
 * The API, independent of where it runs: server/src/node.ts serves it with
 * Node (local development), server/src/worker.ts on Cloudflare Workers.
 * All routes live under /api.
 */
export function createApp({ exams, store, verifyToken, billing, site, appUrl = 'http://localhost:4200' }: AppDeps) {
  const app = new Hono<Env>().basePath('/api');

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const user = header.startsWith('Bearer ') ? await verifyToken(header.slice(7)) : undefined;
    if (!user) return c.json({ error: 'Não autenticado' }, 401);
    c.set('user', user);
    await next();
  };

  const isAdmin = (user: AuthUser) => ADMIN_EMAILS.has(user.email.toLowerCase()) && user.emailVerified !== false;

  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    if (!isAdmin(c.get('user'))) return c.json({ error: 'Acesso restrito' }, 403);
    if (!site) return c.json({ error: 'Painel indisponível' }, 503);
    await next();
  };

  app.get('/health', (c) => c.json({ ok: true }));

  // --- Visits and ads (public) ------------------------------------------------

  /**
   * One page view, sent by the app on every navigation (navigator.sendBeacon, so text/plain).
   * Body: { path, content?, referrer?, utmSource?, utmCampaign?, signedIn? }
   */
  app.post('/track', async (c) => {
    const userAgent = c.req.header('user-agent') ?? '';
    if (!site || isBot(userAgent)) return c.body(null, 204);
    const body = await c.req.text().then((t) => JSON.parse(t), () => null).catch(() => null);
    const path = text(body?.path, 200)?.split(/[?#]/)[0];
    if (!path?.startsWith('/')) return c.body(null, 204);
    await site.recordView({
      path,
      content: text(body?.content, 120),
      referrer: referrerHost(body?.referrer, new URL(appUrl).hostname),
      utmSource: text(body?.utmSource, 60)?.toLowerCase() ?? null,
      utmCampaign: text(body?.utmCampaign, 80),
      ...geoOf(c.req.raw),
      device: deviceOf(userAgent),
      signedIn: body?.signedIn === true,
      fingerprint: `${c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? ''}|${userAgent}`,
    });
    return c.body(null, 204);
  });

  /** What each ad space shows: { [placement]: { source: 'google' | 'off' } | { source: 'partner', ad } }. */
  app.get('/ads', async (c) => {
    c.header('cache-control', 'public, max-age=60');
    if (!site) return c.json({});
    const placements = await site.resolvedPlacements();
    return c.json(
      Object.fromEntries(
        Object.entries(placements).map(([placement, p]) => [
          placement,
          p.source === 'partner'
            ? { ...p, ad: { ...p.ad, imageUrl: `api/ads/image/${p.ad.id}`, href: `api/ads/click/${p.ad.id}?p=${placement}` } }
            : p,
        ]),
      ),
    );
  });

  app.get('/ads/image/:id', async (c) => {
    const image = await site?.partnerImage(c.req.param('id'));
    if (!image) return c.json({ error: 'Not found' }, 404);
    const bytes = Uint8Array.from(atob(image.data), (ch) => ch.charCodeAt(0));
    return c.body(bytes, 200, { 'content-type': image.type, 'cache-control': 'public, max-age=3600' });
  });

  /** A click on a partner ad: counted, then on to the advertiser. */
  app.get('/ads/click/:id', async (c) => {
    const ad = await site?.partnerAd(c.req.param('id'));
    if (!site || !ad) return c.redirect(appUrl, 302);
    const placement = c.req.query('p') ?? '';
    const userAgent = c.req.header('user-agent') ?? '';
    if (placement in AD_PLACEMENTS && !isBot(userAgent)) {
      const { country, region } = geoOf(c.req.raw);
      await site.recordAdEvent({
        placement: placement as AdPlacementId,
        source: 'partner',
        partnerAdId: ad.id,
        kind: 'click',
        country,
        region,
        device: deviceOf(userAgent),
      });
    }
    return c.redirect(ad.linkUrl, 302);
  });

  /** An ad space came into view. Body: { placement, source: 'google' | 'partner', partnerAdId? } (sendBeacon). */
  app.post('/ads/view', async (c) => {
    const userAgent = c.req.header('user-agent') ?? '';
    if (!site || isBot(userAgent)) return c.body(null, 204);
    const body = await c.req.text().then((t) => JSON.parse(t), () => null).catch(() => null);
    const placement = String(body?.placement ?? '');
    const source = body?.source === 'partner' ? 'partner' : 'google';
    if (!(placement in AD_PLACEMENTS)) return c.body(null, 204);
    const { country, region } = geoOf(c.req.raw);
    await site.recordAdEvent({
      placement: placement as AdPlacementId,
      source,
      partnerAdId: source === 'partner' ? text(body?.partnerAdId, 64) : null,
      kind: 'view',
      country,
      region,
      device: deviceOf(userAgent),
    });
    return c.body(null, 204);
  });

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
    // The landing page's numbers: questions with an answer key, exams, and concursos (a concurso,
    // vestibular or residência program; each OAB edition and each ENEM year counts once).
    const concursos = new Set(
      list.map((e) => e.concurso?.id ?? (e.category === 'ENEM' ? `ENEM ${e.year}` : e.label.replace(/ · Tipo \d+$/, ''))),
    );
    return c.json({
      totalQuestions: list.reduce((sum, e) => sum + e.questionCount, 0),
      gradableQuestions: list.reduce((sum, e) => sum + e.gradableCount, 0),
      examCount: list.length,
      concursoCount: concursos.size,
      categories,
    });
  });

  app.get('/exams', async (c) => {
    const category = c.req.query('category');
    return c.json((await exams.list()).filter((e) => !category || e.category === category));
  });

  app.get('/exams/:examId', async (c) => {
    const exam = await exams.get(c.req.param('examId'));
    if (!exam) return c.json({ error: 'Prova não encontrada' }, 404);
    return c.json({ exam: exam.summary, questions: exam.questions.map((q) => toPublicQuestion(q, exam.summary.id, exam.summary.label)) });
  });

  /** Every concurso / vestibular with practisable questions, for the filters (?category=CONCURSOS|VESTIBULARES|RESIDENCIA). */
  app.get('/concursos', async (c) => {
    const category = c.req.query('category');
    const byId = new Map<string, ConcursoInfo & { category: string; examCount: number; questionCount: number }>();
    for (const exam of await exams.list()) {
      if (!exam.concurso || exam.gradableCount === 0 || (category && exam.category !== category)) continue;
      const entry = byId.get(exam.concurso.id) ?? { ...exam.concurso, category: exam.category, examCount: 0, questionCount: 0 };
      entry.examCount++;
      entry.questionCount += exam.gradableCount;
      byId.set(exam.concurso.id, entry);
    }
    return c.json([...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
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
      level: c.req.query('level') || undefined,
      uf: c.req.query('uf') || undefined,
      municipio: c.req.query('municipio') || undefined,
      institution: c.req.query('institution') || undefined,
      concurso: c.req.query('concurso') || undefined,
    });
    return c.json(picked.map(({ question, exam }) => toPublicQuestion(question, exam.id, exam.label)));
  });

  // --- Signed-in user -----------------------------------------------------

  /** Creates the profile on first sign-in and returns it. */
  app.get('/auth/me', requireAuth, async (c) => {
    const { uid, name, email } = c.get('user');
    const user = await store.upsertUser({ id: uid, name, email });
    return c.json(isAdmin(c.get('user')) ? { ...user, admin: true } : user);
  });

  /**
   * Grades answers against the answer key and records them.
   * Body: { answers: [{ questionId, examId, selected }], simulado?: { title, subject? } }
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
    const records: (AnswerRecord & { correctAnswer: string; explanation: string | null; explanationNote: string | null; explanationAi: boolean })[] =
      [];
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
        explanation: question.explanation ?? null,
        explanationNote: question.explanation_note ?? null,
        explanationAi: question.explanation_ai ?? false,
      });
    }

    let simulado;
    if (body?.simulado) {
      const categories = new Set(records.map((r) => r.category));
      const category = categories.size === 1 ? records[0].category : 'Misto';
      const title = String(body.simulado.title ?? '').trim() || `Simulado ${category}`;
      // Kept only if every question really is from that subject.
      const subject = typeof body.simulado.subject === 'string' ? body.simulado.subject : null;
      simulado = { category, title: title.slice(0, 120), subject: subject && records.every((r) => r.subject === subject) ? subject : null };
    }

    // Answers only count once the profile exists (first request may come before /auth/me).
    const { plan } = await store.upsertUser({ id: user.uid, name: user.name, email: user.email });
    const saved = await store.recordAnswers(
      user.uid,
      records.map(({ correctAnswer: _key, explanation: _explanation, explanationNote: _note, explanationAi: _ai, ...record }) => record),
      simulado,
    );
    return c.json(
      {
        results: records.map((r) => {
          const graded = { questionId: r.questionId, selected: r.selected, isCorrect: r.isCorrect, correctAnswer: r.correctAnswer };
          if (!r.explanation) return graded;
          // AI-written explanations (the OAB ones) are Premium; the ones the banca published are for everyone.
          if (r.explanationAi && plan !== 'premium') return { ...graded, explanationLocked: true };
          return {
            ...graded,
            explanation: r.explanation,
            ...(r.explanationNote ? { explanationNote: r.explanationNote } : {}),
            ...(r.explanationAi ? { explanationAi: true } : {}),
          };
        }),
        simulado: saved,
      },
      201,
    );
  });

  /**
   * "Reportar erro": flags a question for review (question_reports, flagged_questions view).
   * Body: { examId, questionId, reason, comment? }; reason "other" needs a comment.
   */
  app.post('/questions/reports', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const exam = await exams.get(String(body?.examId));
    const question = exam?.questions.find((q) => q.id === String(body?.questionId));
    if (!exam || !question) return c.json({ error: 'Questão não encontrada' }, 404);

    const reason = String(body?.reason) as ReportReason;
    if (!REPORT_REASONS.includes(reason)) return c.json({ error: 'Escolha um motivo.' }, 400);
    const comment = String(body?.comment ?? '').trim().slice(0, MAX_REPORT_COMMENT) || null;
    if (reason === 'other' && !comment) return c.json({ error: 'Descreva o problema.' }, 400);

    const { uid, name, email } = c.get('user');
    await store.upsertUser({ id: uid, name, email });
    await store.reportQuestion(uid, { questionId: question.id, examId: exam.summary.id, reason, comment });
    return c.json({ ok: true }, 201);
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

  /**
   * "Análise Avançada" on Estatísticas, Premium only: weakest subjects, time per answer, a 12-week trend
   * and accuracy by exam year, institution and part of the day. ?days=30|90|0&category=OAB&tz=<offset>
   */
  app.get('/me/insights', requireAuth, async (c) => {
    const { uid, name, email } = c.get('user');
    const user = await store.upsertUser({ id: uid, name, email });
    if (user.plan !== 'premium') return c.json({ error: 'Recurso Premium' }, 403);

    const days = Number(c.req.query('days') ?? 90);
    const period = INSIGHT_PERIODS.includes(days) ? days : 90;
    const stats = await store.getInsights(uid, {
      days: period || null,
      category: c.req.query('category') || undefined,
      tzOffsetMinutes: timezoneOffset(c.req.query('tz')),
    });

    const summaries = new Map((await exams.list()).map((e) => [e.id, e]));
    const group = <K extends string | number>(key: (examId: string) => K | undefined) => {
      const totals = new Map<K, { answered: number; correct: number }>();
      for (const row of stats.byExam) {
        const k = key(row.examId);
        if (k === undefined) continue;
        const entry = totals.get(k) ?? { answered: 0, correct: 0 };
        entry.answered += row.answered;
        entry.correct += row.correct;
        totals.set(k, entry);
      }
      return [...totals].map(([k, t]) => ({ key: k, ...t }));
    };

    return c.json({
      days: period || null,
      totals: stats.totals,
      timing: stats.timing,
      bySubject: stats.bySubject,
      weakest: stats.bySubject
        .filter((s) => s.answered >= MIN_ANSWERS_WEAK_SUBJECT)
        .sort((a, b) => a.correct / a.answered - b.correct / b.answered || b.answered - a.answered)
        .slice(0, WEAKEST_SUBJECTS),
      byYear: group((id) => summaries.get(id)?.year)
        .map(({ key, ...t }) => ({ year: key, ...t }))
        .sort((a, b) => b.year - a.year),
      byInstitution: group((id) => summaries.get(id)?.institution)
        .map(({ key, ...t }) => ({ institution: key, ...t }))
        .sort((a, b) => b.answered - a.answered),
      byDayPart: DAY_PARTS.map(({ id, from, to }) => {
        const hours = stats.byHour.filter((h) => h.hour >= from && h.hour < to);
        return { part: id, answered: hours.reduce((n, h) => n + h.answered, 0), correct: hours.reduce((n, h) => n + h.correct, 0) };
      }),
      weekly: stats.weekly,
    });
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

  /** "Resgatar código" on Configurações. Body: { code }; returns the updated profile. */
  app.post('/me/redeem', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const code = normalizeCode(String(body?.code ?? ''));
    if (!code) return c.json({ error: 'Digite o código.' }, 400);
    const { uid, name, email } = c.get('user');
    await store.upsertUser({ id: uid, name, email });
    const result = await store.redeemCode(uid, code);
    return result.ok ? c.json(result.user) : c.json({ error: REDEEM_ERRORS[result.reason] }, result.reason === 'invalid' ? 404 : 409);
  });

  // --- Admin panel -------------------------------------------------------------

  /** ?days=7|30|90|365, the last days up to today (Brasília). */
  app.get('/admin/report', requireAuth, requireAdmin, async (c) => {
    const days = Number(c.req.query('days'));
    const period = REPORT_PERIODS.includes(days) ? days : 30;
    const to = brasiliaDay();
    const report = await site!.report(addDays(to, -(period - 1)), to);
    const labels = new Map((await exams.list()).map((e) => [e.id, { label: e.label, category: e.category }]));
    return c.json({
      ...report,
      days: period,
      exams: report.exams.map((e) => ({ ...e, ...(labels.get(e.examId) ?? { label: e.examId, category: null }) })),
    });
  });

  app.get('/admin/ads', requireAuth, requireAdmin, async (c) => {
    return c.json({ placements: await site!.placementSettings(), partnerAds: await site!.partnerAds() });
  });

  /** Body: { advertiser, title, linkUrl, image: data URL, startsOn?, endsOn?, active? } */
  app.post('/admin/ads', requireAuth, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const fields = partnerAdFields(body);
    if (typeof fields === 'string') return c.json({ error: fields }, 400);
    const image = adImage(body?.image);
    if (typeof image === 'string') return c.json({ error: image }, 400);
    if (!fields.advertiser || !fields.title || !fields.linkUrl) return c.json({ error: 'Preencha anunciante, título e link.' }, 400);
    return c.json(
      await site!.createPartnerAd({
        advertiser: fields.advertiser,
        title: fields.title,
        linkUrl: fields.linkUrl,
        startsOn: fields.startsOn ?? null,
        endsOn: fields.endsOn ?? null,
        active: fields.active ?? true,
        ...image,
      }),
      201,
    );
  });

  /** Same fields as POST, all optional. */
  app.patch('/admin/ads/:id', requireAuth, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const fields = partnerAdFields(body);
    if (typeof fields === 'string') return c.json({ error: fields }, 400);
    const image = body?.image === undefined ? {} : adImage(body.image);
    if (typeof image === 'string') return c.json({ error: image }, 400);
    const ad = await site!.updatePartnerAd(c.req.param('id'), { ...fields, ...image });
    return ad ? c.json(ad) : c.json({ error: 'Anúncio não encontrado' }, 404);
  });

  app.delete('/admin/ads/:id', requireAuth, requireAdmin, async (c) => {
    await site!.deletePartnerAd(c.req.param('id'));
    return c.body(null, 204);
  });

  /** Body: { source: 'google' | 'partner' | 'off', partnerAdId? } */
  app.put('/admin/placements/:placement', requireAuth, requireAdmin, async (c) => {
    const placement = c.req.param('placement');
    const body = await c.req.json().catch(() => null);
    const source = body?.source;
    if (!(placement in AD_PLACEMENTS) || !['google', 'partner', 'off'].includes(source)) return c.json({ error: 'Espaço ou origem inválida' }, 400);
    const partnerAdId = source === 'partner' ? String(body?.partnerAdId ?? '') : null;
    if (source === 'partner' && !(await site!.partnerAd(partnerAdId!))) return c.json({ error: 'Escolha um anúncio de parceiro.' }, 400);
    await site!.setPlacement(placement as AdPlacementId, source, partnerAdId);
    return c.json(await site!.placementSettings());
  });

  app.get('/admin/codes', requireAuth, requireAdmin, async (c) => c.json(await site!.redeemCodes()));

  /** Body: { count, days (0 = no end), maxUses?, expiresOn? (YYYY-MM-DD, Brasília), note? } → { codes } */
  app.post('/admin/codes', requireAuth, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const count = Number(body?.count);
    const days = Number(body?.days);
    const maxUses = Number(body?.maxUses ?? 1);
    if (![count, days, maxUses].every(Number.isInteger) || count < 1 || count > MAX_CODES_PER_REQUEST || days < 0 || maxUses < 1) {
      return c.json({ error: `Quantidade de 1 a ${MAX_CODES_PER_REQUEST}, dias 0 ou mais e usos 1 ou mais.` }, 400);
    }
    const expiresOn = text(body?.expiresOn, 10);
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return c.json({ error: 'Data de validade inválida' }, 400);
    const codes = Array.from({ length: count }, generateCode);
    await store.createRedeemCodes(
      codes.map((code) => ({
        code,
        days: days || null,
        maxUses,
        // The end of that day in Brasília.
        expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59.999-03:00`).toISOString() : null,
        note: text(body?.note, 120),
      })),
    );
    return c.json({ codes }, 201);
  });

  app.post('/admin/codes/:code/expire', requireAuth, requireAdmin, async (c) => {
    await site!.expireCode(c.req.param('code'));
    return c.json({ ok: true });
  });

  // --- Premium subscription (Stripe) ----------------------------------------

  const settingsUrl = (query: string) => `${appUrl}/app/configuracoes?${query}#premium`;

  /** Starts a Stripe Checkout for the monthly Premium; returns { url } to redirect to. */
  app.post('/billing/checkout', requireAuth, async (c) => {
    if (!billing) return c.json({ error: 'Pagamentos indisponíveis no momento.' }, 503);
    const { uid, name, email } = c.get('user');
    const user = await store.upsertUser({ id: uid, name, email });
    if (user.subscription && LIVE_STATUSES.includes(user.subscription.status)) {
      return c.json({ error: 'Você já tem uma assinatura ativa.' }, 409);
    }
    let customerId = await store.billingCustomer(uid);
    if (!customerId) {
      customerId = await billing.createCustomer({ id: uid, email: user.email, name: user.name });
      await store.setBillingCustomer(uid, customerId);
    }
    const url = await billing.checkoutUrl({
      customerId,
      userId: uid,
      successUrl: settingsUrl('assinatura=sucesso'),
      cancelUrl: settingsUrl('assinatura=cancelada'),
    });
    return c.json({ url });
  });

  /** Stripe's customer portal (cancel, change card, invoices); returns { url }. */
  app.post('/billing/portal', requireAuth, async (c) => {
    if (!billing) return c.json({ error: 'Pagamentos indisponíveis no momento.' }, 503);
    const customerId = await store.billingCustomer(c.get('user').uid);
    if (!customerId) return c.json({ error: 'Você ainda não tem uma assinatura.' }, 404);
    return c.json({ url: await billing.portalUrl({ customerId, returnUrl: settingsUrl('assinatura=gerenciada') }) });
  });

  /** Reads the subscription from Stripe right away (back from Checkout, before the webhook arrives); returns the profile. */
  app.post('/billing/sync', requireAuth, async (c) => {
    const { uid, name, email } = c.get('user');
    const customerId = billing && (await store.billingCustomer(uid));
    if (!customerId) return c.json(await store.upsertUser({ id: uid, name, email }));
    return c.json(await store.updateSubscription(customerId, await billing!.subscription(customerId)));
  });

  /**
   * Stripe webhooks (checkout.session.completed, customer.subscription.*, invoice.paid / payment_failed):
   * whatever the event, the customer's subscription is read again from Stripe, so order and retries don't matter.
   */
  app.post('/billing/webhook', async (c) => {
    if (!billing) return c.json({ error: 'Pagamentos indisponíveis' }, 503);
    const result = await billing.webhookCustomer(await c.req.text(), c.req.header('stripe-signature'));
    if (result === 'invalid') return c.json({ error: 'Assinatura inválida' }, 400);
    if (result.customerId) await store.updateSubscription(result.customerId, await billing.subscription(result.customerId));
    return c.json({ received: true });
  });

  /**
   * Deletes the profile, answers and simulados, cancelling a running subscription first.
   * The Firebase account itself is left alone (shared with the mobile app).
   */
  app.delete('/me', requireAuth, async (c) => {
    const customerId = await store.billingCustomer(c.get('user').uid);
    if (customerId && !billing) return c.json({ error: 'Não foi possível cancelar sua assinatura agora. Tente mais tarde.' }, 503);
    if (customerId) await billing!.cancelAll(customerId);
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

type PartnerAdFields = { advertiser?: string; title?: string; linkUrl?: string; startsOn?: string | null; endsOn?: string | null; active?: boolean };

/** The editable fields of a partner ad from a request body, or an error message. */
function partnerAdFields(body: Record<string, unknown> | null): PartnerAdFields | string {
  const fields: PartnerAdFields = {};
  if (body?.advertiser !== undefined) fields.advertiser = text(body.advertiser, 80) ?? '';
  if (body?.title !== undefined) fields.title = text(body.title, 120) ?? '';
  if (body?.linkUrl !== undefined) {
    const link = text(body.linkUrl, 500) ?? '';
    if (!/^https?:\/\/[^\s]+$/i.test(link)) return 'O link precisa começar com https://';
    fields.linkUrl = link;
  }
  for (const key of ['startsOn', 'endsOn'] as const) {
    if (body?.[key] === undefined) continue;
    const day = text(body[key], 10);
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Datas no formato AAAA-MM-DD';
    fields[key] = day;
  }
  if (body?.active !== undefined) fields.active = body.active === true;
  return fields;
}

/** A data URL (data:image/png;base64,…) → stored base64 and type, or an error message. */
function adImage(value: unknown): { image: string; imageType: string } | string {
  const match = typeof value === 'string' ? /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(value) : null;
  if (!match || !AD_IMAGE_TYPES.includes(match[1])) return 'Envie uma imagem PNG, JPG, WebP ou GIF.';
  if ((match[2].length * 3) / 4 > MAX_AD_IMAGE_BYTES) return 'A imagem deve ter até 500 KB.';
  return { image: match[2], imageType: match[1] };
}
