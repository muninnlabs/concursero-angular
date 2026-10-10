import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import type { TokenVerifier } from '../src/auth/firebase.ts';
import { MemoryExamSource, examLabel, isUsable, randomQuestions, toPublicQuestion } from '../src/exams/catalog.ts';
import type { ExamFile, Question } from '../src/exams/types.ts';
import { createSqliteStore } from '../src/users/sqlite-store.ts';
import { badgesFor, levelFor, longestStreak, publicName } from '../src/users/profile.ts';
import { countStreak } from '../src/users/store.ts';

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
const verifyToken: TokenVerifier = async (token) =>
  token.startsWith('valid:') ? { uid: token.slice(6), name: 'Carlos Silva', email: 'Carlos@Example.com' } : undefined;

const app = createApp({ exams, store: createSqliteStore(':memory:'), verifyToken });

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
        simulado: { title: 'OAB — Direito Penal' },
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
    await api('POST', '/api/answers', { answers: [{ questionId: `${EXAM}_q1`, examId: EXAM, selected: 'C' }], simulado: {} }, uid);
    assert.equal((await api('GET', '/api/me/stats', undefined, uid)).body.answered, 1);

    const res = await app.request('/api/me', { method: 'DELETE', headers: { authorization: `Bearer ${uid}` } });
    assert.equal(res.status, 204);
    assert.equal((await api('GET', '/api/me/stats', undefined, uid)).body.answered, 0);
    assert.deepEqual((await api('GET', '/api/me/simulados', undefined, uid)).body, []);
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
  const concursosApp = createApp({ exams: source, store: createSqliteStore(':memory:'), verifyToken });

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
