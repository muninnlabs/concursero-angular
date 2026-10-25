import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { formEncode, verifySignature, type Billing, type SubscriptionState } from '../src/billing/stripe.ts';
import type { TokenVerifier } from '../src/auth/firebase.ts';
import { MemoryExamSource, examLabel, isPlayable, isUsable, randomQuestions, toPublicQuestion } from '../src/exams/catalog.ts';
import { withExplanations } from '../src/exams/explanations.ts';
import { loadExamsFromDisk } from '../src/exams/fs-source.ts';
import type { ExamFile, Question } from '../src/exams/types.ts';
import { createSqliteStore, sqliteDatabase } from '../src/users/sqlite-store.ts';
import { SiteStore, brasiliaDay } from '../src/site/site-store.ts';
import { deviceOf, isBot, referrerHost } from '../src/site/visitor.ts';
import { SqlUserStore } from '../src/users/sql-store.ts';
import { badgesFor, levelFor, longestStreak, publicName } from '../src/users/profile.ts';
import { countStreak, planFor } from '../src/users/store.ts';

function question(id: string, correct: string | null, subject = 'Direito Penal'): Question {
  return {
    id,
    question_number: Number(id.split('_q')[1] ?? 1),
    subject,
    topic: null,
    foreign_language: null,
    context_texts: [],
    image_url: null,
    statement: `Enunciado ${id}`,
    options: ['A', 'B', 'C', 'D'].map((letter) => ({ letter, text: `Opção ${letter}`, is_correct: letter === correct })),
    correct_answer: correct,
  };
}

function exam(id: string, year: number, questions: Question[]): ExamFile {
  return {
    exam_metadata: { exam_id: id, exam_name: id, institution: 'OAB', year, day: 1, booklet_color: 'tipo 1' },
    questions,
  };
}

const EXAM = 'oab_2025_44_tipo1';
const exams = new MemoryExamSource();
// q3 is annulled; q4's id doesn't carry the exam prefix (like 2024_d1_cd1.json).
exams.add('OAB', `assets/provas/oab/${EXAM}.json`, exam(EXAM, 2025, [
  question(`${EXAM}_q1`, 'C'),
  question(`${EXAM}_q2`, 'A', 'Direito Civil'),
  question(`${EXAM}_q3`, null),
  question('legacy_q4', 'B'),
]));

// Tokens look like "valid:<uid>" in tests instead of real Firebase JWTs.
// "valid:premium-…" signs in with an account on the Premium list (store.ts).
const verifyToken: TokenVerifier = async (token) =>
  token.startsWith('valid:')
    ? {
        uid: token.slice(6),
        name: 'Carlos Silva',
        email: token.startsWith('valid:premium-') ? 'AlexandreArteDesigner@gmail.com' : 'Carlos@Example.com',
      }
    : undefined;

// Most tests want plain free accounts; the trial has its own test below.
const NO_TRIAL = { trialDays: 0 };
const app = createApp({ exams, store: createSqliteStore(':memory:', NO_TRIAL), verifyToken });

async function api(method: string, url: string, body?: unknown, token?: string) {
  const res = await app.request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('exams', () => {
  test('lists exams with the Flutter asset path and gradable counts', async () => {
    const { body } = await api('GET', '/api/exams?category=OAB');
    assert.equal(body.length, 1);
    assert.equal(body[0].path, `assets/provas/oab/${EXAM}.json`);
    assert.equal(body[0].questionCount, 4);
    assert.equal(body[0].gradableCount, 3);
  });

  test('never sends the answer key to the browser', async () => {
    const json = JSON.stringify((await api('GET', `/api/exams/${EXAM}`)).body);
    assert.ok(!json.includes('correct_answer'));
    assert.ok(!json.includes('is_correct'));
  });

  test('lists subjects with their practisable question counts', async () => {
    const { body } = await api('GET', '/api/subjects?category=OAB');
    assert.deepEqual(
      body.map((s: { subject: string; questionCount: number }) => [s.subject, s.questionCount]),
      [['Direito Penal', 2], ['Direito Civil', 1]],
    );
  });

  test('practice questions skip annulled questions', async () => {
    const { body } = await api('GET', '/api/practice/questions?count=50&category=OAB');
    assert.deepEqual(body.map((q: Question) => q.id).sort(), ['legacy_q4', `${EXAM}_q1`, `${EXAM}_q2`]);
  });
});

describe('signed-in user', () => {
  const token = 'valid:uid-123';

  test('rejects missing or invalid tokens', async () => {
    assert.equal((await api('GET', '/api/me/stats')).status, 401);
    assert.equal((await api('GET', '/api/me/stats', undefined, 'forged')).status, 401);
  });

  test('creates the profile from the Google account on first sign-in', async () => {
    const { status, body } = await api('GET', '/api/auth/me', undefined, token);
    assert.equal(status, 200);
    assert.deepEqual([body.id, body.name, body.email, body.plan], ['uid-123', 'Carlos Silva', 'carlos@example.com', 'free']);
  });

  test('grades on the server and rejects annulled questions', async () => {
    const annulled = await api('POST', '/api/answers', { answers: [{ questionId: `${EXAM}_q3`, examId: EXAM, selected: 'A' }] }, token);
    assert.equal(annulled.status, 400);

    const { status, body } = await api(
      'POST',
      '/api/answers',
      {
        answers: [
          { questionId: `${EXAM}_q1`, examId: EXAM, selected: 'c' },
          { questionId: `${EXAM}_q2`, examId: EXAM, selected: 'B' },
          { questionId: 'legacy_q4', examId: EXAM, selected: 'B' },
        ],
        simulado: { title: 'OAB — Direito Penal', subject: 'Direito Penal' },
      },
      token,
    );
    assert.equal(status, 201);
    assert.deepEqual(
      body.results.map((r: { isCorrect: boolean; correctAnswer: string }) => [r.isCorrect, r.correctAnswer]),
      [[true, 'C'], [false, 'A'], [true, 'B']],
    );
    assert.equal(body.simulado.correct, 2);

    const stats = await api('GET', '/api/me/stats?category=OAB', undefined, token);
    assert.deepEqual([stats.body.answered, stats.body.accuracy, stats.body.streakDays], [3, 67, 1]);

    const simulados = await api('GET', '/api/me/simulados', undefined, token);
    assert.equal(simulados.body[0].title, 'OAB — Direito Penal');
    // q2 is Direito Civil: a mixed simulado isn't tied to a subject.
    assert.equal(simulados.body[0].subject, null);
  });

  test("users don't see each other's stats", async () => {
    const other = await api('GET', '/api/me/stats', undefined, 'valid:someone-else');
    assert.equal(other.body.answered, 0);
  });

  test('activity: daily split, averages and progress per subject', async () => {
    await api(
      'POST',
      '/api/answers',
      { answers: [{ questionId: `${EXAM}_q1`, examId: EXAM, selected: 'A', durationMs: 30_000 }] },
      token,
    );
    const { status, body } = await api('GET', '/api/me/activity?days=7&category=OAB&tz=180', undefined, token);
    assert.equal(status, 200);
    assert.equal(body.days.length, 7);
    assert.deepEqual(body.days.at(-1), { day: body.days.at(-1).day, correct: 2, wrong: 2 });
    assert.deepEqual(body.current, { answered: 4, correct: 2, avgSeconds: 30 });
    assert.deepEqual(body.previous, { answered: 0, correct: 0, avgSeconds: null });
    const penal = body.bySubject.find((s: { subject: string }) => s.subject === 'Direito Penal');
    assert.deepEqual([penal.answered, penal.correct, penal.questions], [3, 2, 2]);
    assert.equal(body.ranking, null); // not enough answers or users to rank
  });

  test('profile: XP, level, badges and a weekly ranking without full names', async () => {
    // Someone else answers too, so there's a ranking with two people.
    const other = 'valid:ana';
    await api('POST', '/api/answers', { answers: [{ questionId: `${EXAM}_q1`, examId: EXAM, selected: 'C' }] }, other);

    const { status, body } = await api('GET', '/api/me/profile?tz=180', undefined, token);
    assert.equal(status, 200);
    // uid-123 so far: q1 ✓, q2 ✗, q4 ✓ (simulado), q1 ✗ → 10+2+10+2 + 20 for the simulado.
    assert.equal(body.xp, 44);
    assert.deepEqual(body.level, { level: 1, levelXp: 0, nextLevelXp: 100 });
    assert.equal(body.streak.current, 1);
    assert.equal(body.streak.practicedToday, true);
    assert.deepEqual(body.activity, [{ day: body.today, count: 4 }]);
    assert.equal(body.badges.find((b: { id: string }) => b.id === 'primeiro-passo').progress, 4);

    const [first, second] = body.ranking.entries;
    assert.deepEqual([first.name, first.xp, first.you], ['Carlos Silva', 44, true]);
    assert.deepEqual([second.name, second.xp, second.you], ['Carlos S.', 10, false]);
  });

  test('profile: bio and location can be set and cleared', async () => {
    const set = await api('PATCH', '/api/me', { bio: '  Foco na OAB.  ', location: 'Recife, PE' }, token);
    assert.deepEqual([set.body.bio, set.body.location], ['Foco na OAB.', 'Recife, PE']);
    const cleared = await api('PATCH', '/api/me', { bio: '' }, token);
    assert.deepEqual([cleared.body.bio, cleared.body.location], [null, 'Recife, PE']);
    // Signing in again doesn't wipe them.
    assert.equal((await api('GET', '/api/auth/me', undefined, token)).body.location, 'Recife, PE');
  });

  test('deleting the account removes the profile and its history', async () => {
    const uid = 'valid:to-delete';
    const saved = await api(
      'POST',
      '/api/answers',
      { answers: [{ questionId: `${EXAM}_q1`, examId: EXAM, selected: 'C' }], simulado: { subject: 'Direito Penal' } },
      uid,
    );
    assert.equal(saved.body.simulado.subject, 'Direito Penal');
    assert.equal((await api('GET', '/api/me/stats', undefined, uid)).body.answered, 1);

    const res = await app.request('/api/me', { method: 'DELETE', headers: { authorization: `Bearer ${uid}` } });
    assert.equal(res.status, 204);
    assert.equal((await api('GET', '/api/me/stats', undefined, uid)).body.answered, 0);
    assert.deepEqual((await api('GET', '/api/me/simulados', undefined, uid)).body, []);
  });

  test('insights are Premium only', async () => {
    const { status } = await api('GET', '/api/me/insights', undefined, token);
    assert.equal(status, 403);
  });

  test('insights: weakest subjects, timing and accuracy by year, institution and part of day', async () => {
    const premium = 'valid:premium-1';
    assert.equal((await api('GET', '/api/auth/me', undefined, premium)).body.plan, 'premium');
    const answers = [
      ...Array.from({ length: 5 }, () => ({ questionId: `${EXAM}_q2`, examId: EXAM, selected: 'B', durationMs: 40_000 })),
      ...Array.from({ length: 4 }, () => ({ questionId: `${EXAM}_q1`, examId: EXAM, selected: 'C', durationMs: 20_000 })),
      { questionId: `${EXAM}_q1`, examId: EXAM, selected: 'A', durationMs: 40_000 },
    ];
    await api('POST', '/api/answers', { answers }, premium);

    const { status, body } = await api('GET', '/api/me/insights?days=0&category=OAB&tz=180', undefined, premium);
    assert.equal(status, 200);
    assert.equal(body.days, null);
    assert.deepEqual(body.totals, { answered: 10, correct: 4, avgSeconds: 32 });
    assert.deepEqual(body.timing, { correct: 20, wrong: 40 });
    // Direito Civil 0/5 first; Direito Penal 4/5 too, but it's still above the 5-answer floor.
    assert.deepEqual(
      body.weakest.map((s: { subject: string; answered: number; correct: number }) => [s.subject, s.answered, s.correct]),
      [['Direito Civil', 5, 0], ['Direito Penal', 5, 4]],
    );
    assert.deepEqual(body.byYear, [{ year: 2025, answered: 10, correct: 4 }]);
    assert.deepEqual(body.byInstitution, [{ institution: 'OAB', answered: 10, correct: 4 }]);
    assert.equal(body.byDayPart.reduce((n: number, p: { answered: number }) => n + p.answered, 0), 10);
    assert.equal(body.weekly.length, 12);
    assert.deepEqual([body.weekly.at(-1).answered, body.weekly.at(-1).correct], [10, 4]);
  });
});

describe('question reports', () => {
  const token = 'valid:reporter';
  const report = (body: unknown) => api('POST', '/api/questions/reports', body, token);

  test('need a known question, a listed reason and a comment for "other"', async () => {
    assert.equal((await api('POST', '/api/questions/reports', { examId: EXAM, questionId: `${EXAM}_q1`, reason: 'wrong_answer' })).status, 401);
    assert.equal((await report({ examId: EXAM, questionId: 'nope', reason: 'wrong_answer' })).status, 404);
    assert.equal((await report({ examId: EXAM, questionId: `${EXAM}_q1`, reason: 'boring' })).status, 400);
    assert.equal((await report({ examId: EXAM, questionId: `${EXAM}_q1`, reason: 'other', comment: '  ' })).status, 400);
  });

  test('reporting the same reason again is accepted (it refreshes the comment); annulled questions can be reported too', async () => {
    assert.equal((await report({ examId: EXAM, questionId: `${EXAM}_q1`, reason: 'wrong_answer', comment: 'Seria B' })).status, 201);
    assert.equal((await report({ examId: EXAM, questionId: `${EXAM}_q1`, reason: 'wrong_answer', comment: 'Seria D' })).status, 201);
    assert.equal((await report({ examId: EXAM, questionId: `${EXAM}_q3`, reason: 'missing_image' })).status, 201);
  });
});

describe('randomQuestions', () => {
  test('fills the requested count from a few exams, honouring the subject filter', async () => {
    const many = new MemoryExamSource();
    for (let e = 0; e < 6; e++) {
      const id = `oab_20${10 + e}_1_tipo1`;
      many.add('OAB', `assets/provas/oab/${id}.json`, exam(id, 2010 + e,
        Array.from({ length: 8 }, (_, i) => question(`${id}_q${i + 1}`, 'A', i % 2 ? 'Direito Civil' : 'Direito Penal'))));
    }
    const picked = await randomQuestions(many, 10, { category: 'OAB' });
    assert.equal(picked.length, 10);
    assert.equal(new Set(picked.map((p) => p.question.id)).size, 10);

    const civil = await randomQuestions(many, 5, { subject: 'Direito Civil' });
    assert.ok(civil.every((p) => p.question.subject === 'Direito Civil'));
  });
});

describe('question content', () => {
  test('image_url is always sent as a list (the data has both strings and lists)', () => {
    const single = toPublicQuestion({ ...question('x_q1', 'A'), image_url: 'assets/images/a.png' }, 'x');
    const list = toPublicQuestion({ ...question('x_q2', 'A'), image_url: ['assets/images/b.png', 'assets/images/c.png'] }, 'x');
    const none = toPublicQuestion(question('x_q3', 'A'), 'x');
    assert.deepEqual([single.image_urls, list.image_urls, none.image_urls], [['assets/images/a.png'], ['assets/images/b.png', 'assets/images/c.png'], []]);
    assert.ok(!('image_url' in single));
  });

  test('a passage printed with line numbers keeps its numbered lines', () => {
    const lines = [{ n: 1, text: 'Tom Zé, o Último Tropicalista (Edições Sesc), do italiano' }, { n: null, text: 'Pietro Scaramuzzo' }];
    const passage = { type: 'numbered', title: null, content: lines.map((l) => l.text).join('\n'), source: null, lines };
    const sent = toPublicQuestion({ ...question('x_q1', 'A'), context_texts: [passage] }, 'x');
    assert.deepEqual(sent.context_texts[0].lines, lines);
  });

  test('questions with empty options or no body are not usable', () => {
    assert.equal(isUsable(question('x_q1', 'A')), true);
    const emptyOptions = { ...question('x_q2', 'A'), options: ['A', 'B', 'C', 'D'].map((letter) => ({ letter, text: '', is_correct: false })) };
    assert.equal(isUsable(emptyOptions), false);
    const imageOptions = { ...emptyOptions, options: emptyOptions.options.map((o) => ({ ...o, image_url: `assets/images/${o.letter}.png` })) };
    assert.equal(isUsable(imageOptions), true);
    assert.equal(isUsable({ ...question('x_q3', 'A'), statement: '', options: [] }), false);
  });

  test('questions flagged for review and incomplete exams are never served', async () => {
    const source = new MemoryExamSource();
    source.add('ENEM', 'assets/provas/enem/a.json', exam('enem_2013_d1_azul', 2013, [
      question('enem_2013_d1_azul_q1', 'A'),
      { ...question('enem_2013_d1_azul_q2', 'B'), review: { status: 'needs_review', reasons: ['figure cut'] } },
    ]));
    const incomplete = exam('enem_2010_d1_azul', 2010, [question('enem_2010_d1_azul_q1', 'A')]);
    incomplete.exam_metadata.status = 'incomplete';
    source.add('ENEM', 'assets/provas/enem/b.json', incomplete);
    assert.deepEqual((await source.list()).map((e) => e.id), ['enem_2013_d1_azul']);
    const picked = await randomQuestions(source, 10);
    assert.deepEqual(picked.map((p) => p.question.id), ['enem_2013_d1_azul_q1']);
  });

  test('practice never serves unusable questions', async () => {
    const source = new MemoryExamSource();
    source.add('ENEM', 'assets/provas/enem/e.json', exam('enem_2010_d1_azul', 2010, [
      question('enem_2010_d1_azul_q1', 'A'),
      { ...question('enem_2010_d1_azul_q2', 'B'), statement: '', options: [] },
    ]));
    const picked = await randomQuestions(source, 10);
    assert.deepEqual(picked.map((p) => p.question.id), ['enem_2010_d1_azul_q1']);
  });
});

describe('examLabel', () => {
  test('turns exam ids into readable names', () => {
    assert.equal(examLabel('enem_2013_d1_azul'), 'ENEM 2013 · Dia 1 · Caderno Azul');
    assert.equal(examLabel('enem_2024_d1_amarelo'), 'ENEM 2024 · Dia 1 · Caderno Amarelo');
    assert.equal(examLabel('oab_2025_44_tipo1'), 'OAB · 44º Exame (2025) · Tipo 1');
    assert.equal(examLabel('oab_2012_6_reaplicacao_tipo1'), 'OAB · 6º Exame (2012) · Reaplicação · Tipo 1');
    assert.equal(examLabel('oab_2016_20_salvador_tipo1'), 'OAB · 20º Exame (2016) · Salvador · Tipo 1');
    assert.equal(examLabel('something_else'), 'something_else');
  });

  test('is sent with every practice question', async () => {
    const { body } = await api('GET', '/api/practice/questions?count=1&category=OAB');
    assert.equal(body[0].examLabel, 'OAB · 44º Exame (2025) · Tipo 1');
  });

  test('prefers exam_metadata.label (concursos) and grades Certo/Errado items', async () => {
    const id = 'cebraspe_2022_anp_22_conhecimentos_gerais';
    const item = {
      ...question(`${id}_q1`, 'E'),
      options: [
        { letter: 'C', text: 'Certo', is_correct: false },
        { letter: 'E', text: 'Errado', is_correct: true },
      ],
    };
    const source = new MemoryExamSource();
    source.add('CONCURSOS', `assets/provas/concursos/${id}.json`, {
      exam_metadata: { ...exam(id, 2022, []).exam_metadata, label: 'ANP 2022 · Conhecimentos gerais' },
      questions: [item],
    });
    const [summary] = await source.list();
    assert.equal(summary.label, 'ANP 2022 · Conhecimentos gerais');
    assert.equal(summary.gradableCount, 1);
    const picked = await randomQuestions(source, 1, { category: 'CONCURSOS' });
    assert.equal(toPublicQuestion(picked[0].question, id, summary.label).examLabel, 'ANP 2022 · Conhecimentos gerais');
  });
});

describe('concursos filters', () => {
  function concursoExam(id: string, level: 'federal' | 'estadual' | 'municipal', uf: string | null, municipio: string | null, concurso: string): ExamFile {
    const base = exam(id, 2021, [question(`${id}_q1`, 'C'), question(`${id}_q2`, 'E'), question(`${id}_q3`, null)]);
    return {
      ...base,
      exam_metadata: { ...base.exam_metadata, level, uf, municipio, concurso: { id: concurso, name: concurso.toUpperCase() } },
    };
  }
  const source = new MemoryExamSource();
  source.add('CONCURSOS', 'a.json', concursoExam('prf_basicos', 'federal', null, null, 'prf_21'));
  source.add('CONCURSOS', 'b.json', concursoExam('prf_especificos', 'federal', null, null, 'prf_21'));
  source.add('CONCURSOS', 'c.json', concursoExam('pcrj', 'estadual', 'RJ', null, 'pcrj_21'));
  source.add('CONCURSOS', 'd.json', concursoExam('pgm_recife', 'municipal', 'PE', 'Recife', 'pgm_recife_22'));
  source.add('OAB', 'e.json', exam('oab_2025_44_tipo1', 2025, [question('oab_2025_44_tipo1_q1', 'A')]));
  const concursosApp = createApp({ exams: source, store: createSqliteStore(':memory:', NO_TRIAL), verifyToken });

  async function examIds(query: string) {
    const res = await concursosApp.request(`/api/practice/questions?count=50&category=CONCURSOS&${query}`);
    return [...new Set(((await res.json()) as { examId: string }[]).map((q) => q.examId))].sort();
  }

  test('lists each concurso once with its playable question count', async () => {
    const res = await concursosApp.request('/api/concursos');
    const body = (await res.json()) as { id: string; level: string; uf: string | null; examCount: number; questionCount: number }[];
    assert.deepEqual(
      body.map((c) => [c.id, c.level, c.uf, c.examCount, c.questionCount]),
      [
        ['pcrj_21', 'estadual', 'RJ', 1, 2],
        ['pgm_recife_22', 'municipal', 'PE', 1, 2],
        ['prf_21', 'federal', null, 2, 4],
      ],
    );
  });

  test('narrows practice questions by level, state, município and concurso', async () => {
    assert.deepEqual(await examIds('level=federal'), ['prf_basicos', 'prf_especificos']);
    assert.deepEqual(await examIds('level=estadual&uf=RJ'), ['pcrj']);
    assert.deepEqual(await examIds('level=municipal&uf=PE&municipio=Recife'), ['pgm_recife']);
    assert.deepEqual(await examIds('concurso=prf_21'), ['prf_basicos', 'prf_especificos']);
    assert.deepEqual(await examIds('level=estadual&uf=SP'), []);
  });

  test('vestibulares: privada level, university filter and per-category concurso lists', async () => {
    const vest = new MemoryExamSource();
    const v = (id: string, level: 'federal' | 'estadual' | 'privada', uf: string, institution: string) => {
      const file = concursoExam(id, level as 'federal', uf, null, `${id}_ed`);
      return { ...file, exam_metadata: { ...file.exam_metadata, institution } };
    };
    vest.add('VESTIBULARES', 'v1.json', v('fuvest_2024', 'estadual', 'SP', 'USP'));
    vest.add('VESTIBULARES', 'v2.json', v('unb_2024', 'federal', 'DF', 'UnB'));
    vest.add('VESTIBULARES', 'v3.json', v('mackenzie_2024', 'privada', 'SP', 'Mackenzie'));
    vest.add('CONCURSOS', 'c1.json', concursoExam('pcrj', 'estadual', 'RJ', null, 'pcrj_21'));
    const vestApp = createApp({ exams: vest, store: createSqliteStore(':memory:', NO_TRIAL), verifyToken });
    const list = (await (await vestApp.request('/api/concursos?category=VESTIBULARES')).json()) as { id: string; category: string }[];
    assert.deepEqual(list.map((c) => [c.id, c.category]), [
      ['fuvest_2024_ed', 'VESTIBULARES'],
      ['mackenzie_2024_ed', 'VESTIBULARES'],
      ['unb_2024_ed', 'VESTIBULARES'],
    ]);
    const ids = async (query: string) => {
      const res = await vestApp.request(`/api/practice/questions?count=50&category=VESTIBULARES&${query}`);
      return [...new Set(((await res.json()) as { examId: string }[]).map((q) => q.examId))].sort();
    };
    assert.deepEqual(await ids('level=privada'), ['mackenzie_2024']);
    assert.deepEqual(await ids('uf=SP'), ['fuvest_2024', 'mackenzie_2024']);
    assert.deepEqual(await ids('institution=UnB'), ['unb_2024']);
  });
});

describe('residência médica data', () => {
  test('every exam is listed under RESIDENCIA with its institution, and every playable answer is one of its options', async () => {
    const source = await loadExamsFromDisk(new URL('../../assets', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const residencia = (await source.list()).filter((e) => e.category === 'RESIDENCIA');
    assert.ok(residencia.length >= 30, `${residencia.length} exams`);
    for (const summary of residencia) {
      assert.ok(summary.concurso?.institution && summary.concurso.level, summary.id);
      const exam = await source.get(summary.id);
      const playable = exam!.questions.filter(isPlayable);
      assert.ok(playable.length >= 0.3 * exam!.questions.length, `${summary.id}: ${playable.length} playable`);
      for (const q of playable) {
        assert.ok(q.options.some((o) => o.letter === q.correct_answer), q.id);
      }
    }
  });
});

describe('explanations', () => {
  const id = 'acafe_2024_1_prova_objetiva';
  const source = new MemoryExamSource();
  source.add('VESTIBULARES', 'acafe.json', exam(id, 2024, [{ ...question(`${id}_q1`, 'B'), explanation: 'B, porque sim.' }]));
  const explApp = createApp({ exams: source, store: createSqliteStore(':memory:', NO_TRIAL), verifyToken });

  test('are not sent with the question, only with the graded answer', async () => {
    const practice = await explApp.request('/api/practice/questions?count=1');
    const [q] = (await practice.json()) as Record<string, unknown>[];
    assert.equal('explanation' in q, false);
    const graded = await explApp.request('/api/answers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid:expl' },
      body: JSON.stringify({ answers: [{ questionId: `${id}_q1`, examId: id, selected: 'A' }] }),
    });
    const body = (await graded.json()) as { results: { isCorrect: boolean; explanation?: string }[] };
    assert.equal(body.results[0].isCorrect, false);
    assert.equal(body.results[0].explanation, 'B, porque sim.');
  });

  test('generated ones are merged in, flagged as AI, and held back when they dispute the key', async () => {
    const oab = 'oab_2010_1_tipo1';
    const generated = (explanation: string, agrees = true) => ({
      explanation,
      update_note: agrees ? 'Hoje vale o CPC/2015.' : null,
      agrees_with_key: agrees,
      confidence: 'alta',
      model: 'test',
      generated_at: '2026-10-22',
    });
    const data = withExplanations(exam(oab, 2010, [question(`${oab}_q1`, 'C'), question(`${oab}_q2`, 'A')]), {
      [`${oab}_q1`]: generated('C, pelo art. 295.'),
      [`${oab}_q2`]: generated('O gabarito parece errado.', false),
    });
    const oabSource = new MemoryExamSource();
    oabSource.add('OAB', 'oab.json', data);
    const oabApp = createApp({ exams: oabSource, store: createSqliteStore(':memory:', NO_TRIAL), verifyToken });
    const grade = async (token: string) => {
      const graded = await oabApp.request('/api/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          answers: [
            { questionId: `${oab}_q1`, examId: oab, selected: 'C' },
            { questionId: `${oab}_q2`, examId: oab, selected: 'A' },
          ],
        }),
      });
      return ((await graded.json()) as { results: Record<string, unknown>[] }).results;
    };
    // AI explanations are Premium: free accounts only learn that there is one.
    const free = await grade('valid:oab');
    assert.deepEqual([free[0].explanationLocked, 'explanation' in free[0], 'explanationLocked' in free[1]], [true, false, false]);

    const results = await grade('valid:premium-oab');
    assert.deepEqual(
      { explanation: results[0].explanation, note: results[0].explanationNote, ai: results[0].explanationAi },
      { explanation: 'C, pelo art. 295.', note: 'Hoje vale o CPC/2015.', ai: true },
    );
    assert.equal('explanation' in results[1], false);
  });
});

describe('redeem codes', () => {
  const store = createSqliteStore(':memory:', NO_TRIAL);
  const codeApp = createApp({ exams, store, verifyToken });
  const redeem = async (token: string, code: string) => {
    const res = await codeApp.request('/api/me/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  test('give Premium days that add up, once per account and up to max_uses accounts', async () => {
    await store.createRedeemCodes([
      { code: 'AAAA-BBBB-CCCC', days: 30, maxUses: 2 },
      { code: 'DDDD-EEEE-FFFF', days: 10 },
      { code: 'OLD0-OLD0-OLD0', days: 30, expiresAt: '2020-01-01T00:00:00.000Z' },
    ]);
    assert.equal((await redeem('valid:r1', 'nope')).status, 404);
    assert.equal((await redeem('valid:r1', 'OLD0OLD0OLD0')).status, 404);

    const first = await redeem('valid:r1', ' aaaa bbbb cccc ');
    assert.equal(first.status, 200);
    assert.equal(first.body.plan, 'premium');
    const days = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
    assert.equal(days(first.body.premiumUntil), 30);
    assert.equal((await redeem('valid:r1', 'AAAA-BBBB-CCCC')).body.error, 'Você já usou este código.');

    const stacked = await redeem('valid:r1', 'DDDD-EEEE-FFFF');
    assert.equal(days(stacked.body.premiumUntil), 40);

    assert.equal((await redeem('valid:r2', 'AAAA-BBBB-CCCC')).status, 200);
    assert.equal((await redeem('valid:r3', 'AAAA-BBBB-CCCC')).body.error, 'Este código já foi usado.');
  });

  test('Premium ends with premium_until', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    assert.equal(planFor('a@example.com', 'premium', '2026-10-26T00:00:00.000Z', now), 'premium');
    assert.equal(planFor('a@example.com', 'premium', '2026-10-25T00:00:00.000Z', now), 'free');
    assert.equal(planFor('a@example.com', 'premium', null, now), 'premium');
    assert.equal(planFor('a@example.com', 'free', null, now), 'free');
  });
});

describe('Stripe subscription', () => {
  // A fake Stripe: one customer per user, the subscription set by the test.
  const subscriptions = new Map<string, SubscriptionState | null>();
  const cancelled: string[] = [];
  let pendingEvent: string | null = null;
  const billing: Billing = {
    createCustomer: async (user) => `cus_${user.id}`,
    checkoutUrl: async ({ customerId, successUrl }) => `https://checkout.test/${customerId}?next=${encodeURIComponent(successUrl)}`,
    portalUrl: async ({ customerId }) => `https://portal.test/${customerId}`,
    subscription: async (customerId) => subscriptions.get(customerId) ?? null,
    cancelAll: async (customerId) => {
      cancelled.push(customerId);
    },
    webhookCustomer: async (_payload, signature) => (signature === 'ok' ? { customerId: pendingEvent } : 'invalid'),
  };
  const store = createSqliteStore(':memory:', NO_TRIAL);
  const payApp = createApp({ exams, store, verifyToken, billing, appUrl: 'https://site.test/app-base' });
  const call = async (method: string, url: string, token?: string, headers: Record<string, string> = {}, body?: string) => {
    const res = await payApp.request(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
  };
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  test('checkout creates the customer once and returns to Configurações', async () => {
    const first = await call('POST', '/api/billing/checkout', 'valid:payer');
    assert.equal(first.status, 200);
    assert.equal(
      first.body.url,
      `https://checkout.test/cus_payer?next=${encodeURIComponent('https://site.test/app-base/app/configuracoes?assinatura=sucesso#premium')}`,
    );
    assert.equal(await store.billingCustomer('payer'), 'cus_payer');
    assert.equal((await call('POST', '/api/billing/portal', 'valid:payer')).body.url, 'https://portal.test/cus_payer');
    assert.equal((await call('POST', '/api/billing/portal', 'valid:nobody')).status, 404);
  });

  test('the webhook and sync read the subscription from Stripe', async () => {
    subscriptions.set('cus_payer', { status: 'active', periodEnd: inDays(30), renews: true });
    pendingEvent = 'cus_payer';
    assert.equal((await call('POST', '/api/billing/webhook', undefined, { 'stripe-signature': 'forged' }, '{}')).status, 400);
    assert.equal((await call('POST', '/api/billing/webhook', undefined, { 'stripe-signature': 'ok' }, '{}')).status, 200);
    const me = (await call('GET', '/api/auth/me', 'valid:payer')).body;
    assert.deepEqual([me.plan, me.subscription.renews], ['premium', true]);
    assert.equal((await call('POST', '/api/billing/checkout', 'valid:payer')).status, 409);

    // Cancelled: Premium until the end of the paid period, then free.
    subscriptions.set('cus_payer', { status: 'active', periodEnd: inDays(10), renews: false });
    assert.deepEqual(
      [(await call('POST', '/api/billing/sync', 'valid:payer')).body.plan, (await call('GET', '/api/auth/me', 'valid:payer')).body.subscription.renews],
      ['premium', false],
    );
    subscriptions.set('cus_payer', { status: 'canceled', periodEnd: inDays(-1), renews: false });
    assert.equal((await call('POST', '/api/billing/sync', 'valid:payer')).body.plan, 'free');
  });

  test('a past period still counts for two days, while a renewal is on its way', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    const live = (periodEnd: string) => planFor('a@example.com', 'free', null, now, { status: 'active', periodEnd });
    assert.equal(live('2026-10-24T12:00:00.000Z'), 'premium');
    assert.equal(live('2026-10-23T11:00:00.000Z'), 'free');
    assert.equal(planFor('a@example.com', 'free', null, now, { status: 'unpaid', periodEnd: '2026-11-01T00:00:00.000Z' }), 'free');
  });

  test('deleting the account cancels the subscription', async () => {
    assert.equal((await call('DELETE', '/api/me', 'valid:payer')).status, 204);
    assert.deepEqual(cancelled, ['cus_payer']);
  });

  test('without Stripe the payment routes answer 503', async () => {
    assert.equal((await api('POST', '/api/billing/checkout', undefined, 'valid:x')).status, 503);
  });
});

describe('Stripe helpers', () => {
  test('form encoding nests like Stripe expects', () => {
    assert.equal(
      decodeURIComponent(formEncode({ mode: 'subscription', line_items: [{ price: 'p', quantity: 1 }], metadata: { uid: 'u' }, skip: undefined })),
      'mode=subscription&line_items[0][price]=p&line_items[0][quantity]=1&metadata[uid]=u',
    );
  });

  test('webhook signatures: HMAC of "t.payload", recent only', async () => {
    const secret = 'whsec_test';
    const payload = '{"id":"evt_1"}';
    const t = 1_800_000_000;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))).toString('hex');
    const header = `t=${t},v1=${mac}`;
    assert.equal(await verifySignature(payload, header, secret, t * 1000), true);
    assert.equal(await verifySignature(payload + ' ', header, secret, t * 1000), false);
    assert.equal(await verifySignature(payload, header, 'whsec_other', t * 1000), false);
    assert.equal(await verifySignature(payload, header, secret, (t + 600) * 1000), false);
    assert.equal(await verifySignature(payload, undefined, secret), false);
  });
});

describe('admin panel, visits and ads', () => {
  const db = sqliteDatabase(':memory:');
  const site = new SiteStore(db);
  const adminApp = createApp({ exams, store: new SqlUserStore(db), site, verifyToken, appUrl: 'https://munninlabs.com/concursero-angular' });
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
  const ADMIN = 'valid:premium-admin';

  // Like Cloudflare: request.cf carries the location, cf-connecting-ip the address.
  async function send(method: string, url: string, { body, token, ua = CHROME, ip = '203.0.113.1', cf = { country: 'BR', region: 'São Paulo', city: 'Campinas' } }: {
    body?: unknown; token?: string; ua?: string; ip?: string; cf?: object;
  } = {}) {
    const request = new Request(`http://x${url}`, {
      method,
      headers: { 'user-agent': ua, 'cf-connecting-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'text/plain' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    Object.defineProperty(request, 'cf', { value: cf });
    const res = await adminApp.request(request);
    const raw = await res.text();
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = raw; }
    return { status: res.status, body: json, location: res.headers.get('location') };
  }

  test('visits: one visitor per browser and day, bots and own referrers left out', async () => {
    await send('POST', '/api/track', { body: { path: '/', referrer: 'https://www.google.com/search?q=oab', utmSource: 'Instagram', utmCampaign: 'lancamento' } });
    await send('POST', '/api/track', { body: { path: '/app/praticar?modo=mini', content: 'OAB · Direito Penal', referrer: 'https://munninlabs.com/concursero-angular/', signedIn: true } });
    await send('POST', '/api/track', { body: { path: '/app' }, ua: PHONE, ip: '198.51.100.7', cf: { country: 'BR', region: 'Bahia', city: 'Salvador' } });
    await send('POST', '/api/track', { body: { path: '/' }, ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    await send('POST', '/api/track', { body: { path: 'not-a-path' } });

    const { status, body: report } = await send('GET', '/api/admin/report?days=7', { token: ADMIN });
    assert.equal(status, 200);
    assert.deepEqual([report.totals.views, report.totals.visitors, report.totals.signedInViews], [3, 2, 1]);
    assert.deepEqual(report.daily, [{ day: brasiliaDay(), views: 3, visitors: 2 }]);
    assert.deepEqual(report.pages.map((p: any) => p.path).sort(), ['/', '/app', '/app/praticar']);
    assert.deepEqual(report.content, [{ content: 'OAB · Direito Penal', views: 1, visitors: 1 }]);
    // Same visitors: more views first.
    assert.deepEqual(report.regions.map((r: any) => [r.region, r.views]), [['São Paulo', 2], ['Bahia', 1]]);
    assert.deepEqual(report.referrers.find((r: any) => r.referrer === 'google.com')?.visitors, 1);
    assert.deepEqual(report.campaigns, [{ source: 'instagram', campaign: 'lancamento', views: 1, visitors: 1 }]);
    assert.deepEqual(report.devices.map((d: any) => d.device).sort(), ['desktop', 'mobile']);
    // No address is stored, only the salted hash.
    const row = await db.first<Record<string, unknown>>('SELECT * FROM page_views LIMIT 1');
    assert.ok(!JSON.stringify(row).includes('203.0.113.1'));
  });

  test('only the admin accounts open the panel', async () => {
    assert.equal((await send('GET', '/api/admin/report', { token: 'valid:someone' })).status, 403);
    assert.equal((await send('GET', '/api/admin/report')).status, 401);
    assert.equal((await send('GET', '/api/auth/me', { token: ADMIN })).body.admin, true);
    assert.equal((await send('GET', '/api/auth/me', { token: 'valid:someone' })).body.admin, undefined);
    const unverified = createApp({ exams, store: new SqlUserStore(db), site, verifyToken: async () => ({ uid: 'u', name: 'X', email: 'alex.munninlabs@gmail.com', emailVerified: false }) });
    const res = await unverified.request('/api/admin/codes', { headers: { authorization: 'Bearer t' } });
    assert.equal(res.status, 403);
  });

  test('partner ads: placement switch, dates fall back to Google, views and clicks counted', async () => {
    assert.deepEqual((await send('GET', '/api/ads')).body['dashboard-top'], { source: 'google' });
    const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
    assert.equal((await send('POST', '/api/admin/ads', { token: ADMIN, body: { advertiser: 'Uni X', title: 'Vestibular', linkUrl: 'javascript:alert(1)', image: png } })).status, 400);
    const created = await send('POST', '/api/admin/ads', {
      token: ADMIN,
      body: { advertiser: 'Uni X', title: 'Vestibular 2027', linkUrl: 'https://unix.edu.br/vestibular', image: png },
    });
    assert.equal(created.status, 201);
    const id = created.body.id;
    await send('PUT', '/api/admin/placements/dashboard-top', { token: ADMIN, body: { source: 'partner', partnerAdId: id } });
    await send('PUT', '/api/admin/placements/stats-top', { token: ADMIN, body: { source: 'off' } });
    const ads = (await send('GET', '/api/ads')).body;
    assert.deepEqual(ads['dashboard-top'].ad, { id, advertiser: 'Uni X', title: 'Vestibular 2027', imageUrl: `api/ads/image/${id}`, href: `api/ads/click/${id}?p=dashboard-top` });
    assert.equal(ads['stats-top'].source, 'off');

    const image = await adminApp.request(`/api/ads/image/${id}`);
    assert.deepEqual([image.headers.get('content-type'), await image.text()], ['image/png', 'fake-png']);

    await send('POST', '/api/ads/view', { body: { placement: 'dashboard-top', source: 'partner', partnerAdId: id } });
    await send('POST', '/api/ads/view', { body: { placement: 'landing-top', source: 'google' } });
    const click = await send('GET', `/api/ads/click/${id}?p=dashboard-top`);
    assert.deepEqual([click.status, click.location], [302, 'https://unix.edu.br/vestibular']);
    const report = (await send('GET', '/api/admin/report?days=30', { token: ADMIN })).body;
    assert.deepEqual(report.partnerAds, [{ partnerAdId: id, views: 1, clicks: 1 }]);
    assert.deepEqual(report.ads.find((a: any) => a.placement === 'landing-top'), { placement: 'landing-top', source: 'google', views: 1, clicks: 0 });

    // Ended yesterday: Google again, without touching the placement.
    await send('PATCH', `/api/admin/ads/${id}`, { token: ADMIN, body: { endsOn: '2020-01-01' } });
    assert.deepEqual((await send('GET', '/api/ads')).body['dashboard-top'], { source: 'google' });
    assert.equal((await send('DELETE', `/api/admin/ads/${id}`, { token: ADMIN })).status, 204);
    assert.equal((await send('GET', '/api/admin/ads', { token: ADMIN })).body.placements.find((p: any) => p.placement === 'dashboard-top').source, 'google');
  });

  test('redeem codes are generated from the panel and can be stopped', async () => {
    const made = await send('POST', '/api/admin/codes', { token: ADMIN, body: { count: 3, days: 30, maxUses: 2, note: 'Feira' } });
    assert.equal(made.status, 201);
    assert.equal(made.body.codes.length, 3);
    assert.match(made.body.codes[0], /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const code = made.body.codes[0];
    assert.equal((await send('POST', '/api/me/redeem', { token: 'valid:student', body: { code } })).status, 200);
    let listed = (await send('GET', '/api/admin/codes', { token: ADMIN })).body.find((c: any) => c.code === code);
    assert.deepEqual([listed.uses, listed.maxUses, listed.days, listed.note], [1, 2, 30, 'Feira']);
    await send('POST', `/api/admin/codes/${code}/expire`, { token: ADMIN });
    assert.equal((await send('POST', '/api/me/redeem', { token: 'valid:student2', body: { code } })).status, 404);
    assert.equal((await send('POST', '/api/admin/codes', { token: ADMIN, body: { count: 0, days: 30 } })).status, 400);
  });

  test('visitor helpers', () => {
    assert.equal(isBot('WhatsApp/2.23'), true);
    assert.equal(isBot(CHROME), false);
    assert.deepEqual([deviceOf(CHROME), deviceOf(PHONE), deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0)')], ['desktop', 'mobile', 'tablet']);
    assert.equal(referrerHost('https://www.instagram.com/x', 'munninlabs.com'), 'instagram.com');
    assert.equal(referrerHost('https://munninlabs.com/a', 'munninlabs.com'), null);
    assert.equal(referrerHost('garbage', 'munninlabs.com'), null);
  });
});

describe('countStreak', () => {
  const today = new Date('2026-09-26T15:00:00Z');

  test('counts consecutive days ending today', () => {
    assert.equal(countStreak(['2026-09-26', '2026-09-25', '2026-09-24', '2026-09-20'], today), 3);
  });

  test('a streak survives until the day is over', () => {
    assert.equal(countStreak(['2026-09-25', '2026-09-24'], today), 2);
  });

  test('a missed day resets it', () => {
    assert.equal(countStreak(['2026-09-24'], today), 0);
    assert.equal(countStreak([], today), 0);
  });
});

describe('profile rules', () => {
  test('levels get 100 XP longer each time', () => {
    assert.deepEqual([0, 99, 100, 299, 300, 600].map((xp) => levelFor(xp).level), [1, 1, 2, 2, 3, 4]);
    assert.deepEqual(levelFor(12_400), { level: 16, levelXp: 12_000, nextLevelXp: 13_600 });
  });

  test('longest streak ignores order and gaps', () => {
    assert.equal(longestStreak(['2026-09-03', '2026-09-01', '2026-09-02', '2026-09-10', '2026-09-11']), 3);
    assert.equal(longestStreak([]), 0);
  });

  test('Especialista needs volume and 80% in one subject', () => {
    const expert = (bySubject: { subject: string; answered: number; correct: number }[]) =>
      badgesFor({ answered: 0, longestStreak: 0, simulados: 0, perfectSimulados: 0, bySubject }).find((b) => b.id === 'especialista')!;
    assert.equal(expert([{ subject: 'Direito Penal', answered: 60, correct: 47 }]).unlocked, false);
    const earned = expert([{ subject: 'Direito Penal', answered: 60, correct: 50 }]);
    assert.deepEqual([earned.unlocked, earned.detail], [true, 'Direito Penal']);
  });

  test('other students appear as first name and initial', () => {
    assert.deepEqual(['Ana Paula Souza', 'Ana', '  '].map(publicName), ['Ana S.', 'Ana', 'Estudante']);
  });
});

describe('Premium trial', () => {
  const trialApp = createApp({ exams, store: createSqliteStore(':memory:'), verifyToken });
  const me = async (token: string) => (await (await trialApp.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })).json()) as any;
  const del = (token: string) => trialApp.request('/api/me', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });

  test('new accounts get 7 days of Premium, once per e-mail even after deleting the account', async () => {
    const first = await me('valid:trial-1');
    assert.equal(first.plan, 'premium');
    assert.equal(Math.round((Date.parse(first.premiumUntil) - Date.now()) / 86_400_000), 7);
    // Signing in again doesn't extend it.
    assert.equal((await me('valid:trial-1')).premiumUntil, first.premiumUntil);

    assert.equal((await del('valid:trial-1')).status, 204);
    const again = await me('valid:trial-1');
    assert.deepEqual([again.plan, again.premiumUntil], ['free', null]);
  });
});
