import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { ExamCatalog } from '../src/exams/catalog.ts';
import type { ExamFile, Question } from '../src/exams/types.ts';
import { SqliteUserStore, countStreak } from '../src/users/sqlite-store.ts';

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

const oabExam: ExamFile = {
  exam_metadata: { exam_id: 'oab_2025_44_tipo1', exam_name: '44º Exame', institution: 'OAB', year: 2025, day: 1, booklet_color: 'tipo 1' },
  // q3 is annulled; q4's id doesn't carry the exam prefix (like 2024_d1_cd1.json).
  questions: [question('oab_2025_44_tipo1_q1', 'C'), question('oab_2025_44_tipo1_q2', 'A', 'Direito Civil'), question('oab_2025_44_tipo1_q3', null), question('legacy_q4', 'B')],
};

let baseUrl: string;
let close: () => void;

async function api(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  const assetsDir = await mkdtemp(path.join(tmpdir(), 'concursero-assets-'));
  await mkdir(path.join(assetsDir, 'provas', 'oab'), { recursive: true });
  await writeFile(path.join(assetsDir, 'provas', 'oab', 'oab_2025_44_tipo1.json'), JSON.stringify(oabExam));

  const catalog = await ExamCatalog.load(assetsDir);
  const server = createApp({ catalog, store: new SqliteUserStore(':memory:'), jwtSecret: 'test-secret', assetsDir }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

describe('exams', () => {
  test('lists exams with the Flutter asset path and gradable counts', async () => {
    const { body } = await api('GET', '/api/exams?category=OAB');
    assert.equal(body.length, 1);
    assert.equal(body[0].path, 'assets/provas/oab/oab_2025_44_tipo1.json');
    assert.equal(body[0].questionCount, 4);
    assert.equal(body[0].gradableCount, 3);
  });

  test('never sends the answer key to the browser', async () => {
    const { body } = await api('GET', '/api/exams/oab_2025_44_tipo1');
    const json = JSON.stringify(body);
    assert.ok(!json.includes('correct_answer'));
    assert.ok(!json.includes('is_correct'));
  });

  test('practice questions skip annulled questions', async () => {
    const { body } = await api('GET', '/api/practice/questions?count=50&category=OAB');
    assert.deepEqual(body.map((q: Question) => q.id).sort(), ['legacy_q4', 'oab_2025_44_tipo1_q1', 'oab_2025_44_tipo1_q2']);
  });
});

describe('auth and stats', () => {
  let token: string;

  test('register, reject duplicates, log in', async () => {
    const credentials = { name: 'Carlos Silva', email: 'Carlos@Example.com', password: 'segredo123' };
    const registered = await api('POST', '/api/auth/register', credentials);
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.email, 'carlos@example.com');
    assert.equal(registered.body.user.passwordHash, undefined);

    assert.equal((await api('POST', '/api/auth/register', credentials)).status, 409);
    assert.equal((await api('POST', '/api/auth/login', { ...credentials, password: 'errada123' })).status, 401);

    const login = await api('POST', '/api/auth/login', credentials);
    assert.equal(login.status, 200);
    token = login.body.token;
    assert.equal((await api('GET', '/api/auth/me', undefined, token)).body.name, 'Carlos Silva');
  });

  test('stats require a token', async () => {
    assert.equal((await api('GET', '/api/me/stats')).status, 401);
    assert.equal((await api('GET', '/api/me/stats', undefined, 'bogus')).status, 401);
  });

  test('grades on the server and rejects annulled questions', async () => {
    const annulled = await api('POST', '/api/answers', { answers: [{ questionId: 'oab_2025_44_tipo1_q3', selected: 'A' }] }, token);
    assert.equal(annulled.status, 400);

    const { status, body } = await api(
      'POST',
      '/api/answers',
      {
        answers: [
          { questionId: 'oab_2025_44_tipo1_q1', selected: 'c' },
          { questionId: 'oab_2025_44_tipo1_q2', selected: 'B' },
          { questionId: 'legacy_q4', selected: 'B' },
        ],
        simulado: { title: 'OAB — Direito Penal' },
      },
      token,
    );
    assert.equal(status, 201);
    assert.deepEqual(
      body.results.map((r: { isCorrect: boolean }) => r.isCorrect),
      [true, false, true],
    );
    assert.equal(body.simulado.correct, 2);

    const stats = await api('GET', '/api/me/stats?category=OAB', undefined, token);
    assert.equal(stats.body.answered, 3);
    assert.equal(stats.body.accuracy, 67);
    assert.equal(stats.body.streakDays, 1);

    const simulados = await api('GET', '/api/me/simulados', undefined, token);
    assert.equal(simulados.body[0].title, 'OAB — Direito Penal');
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
