// Writes an explanation ("comentário") for each OAB question with Claude, through
// the Message Batches API. Results go to assets/explanations/oab.json, keyed by
// question id, rather than into the exam files: sync-assets overwrites those.
//
//   node --env-file=<file with ANTHROPIC_API_KEY> scripts/explain-oab.mjs <command>
//     try <question-id>      one synchronous request, printed (for prompt tuning)
//     run --sample 50        like submit, but now, with direct requests (full price, no queue)
//     submit --sample 50     a batch with N questions spread across subjects and years
//     submit --all           a batch with every question that has no explanation yet
//     status                 progress of the submitted batches
//     collect                save the results of finished batches
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const MODEL = 'claude-opus-5-5';
const EFFORT = 'high';
const MAX_TOKENS = 16000;
// Batch prices (USD per million tokens), for the cost line printed by collect; direct requests cost double.
const PRICE = { input: 2, output: 10 };
const CONCURRENCY = 5;

const root = path.resolve(import.meta.dirname, '..');
const examDir = path.join(root, 'assets', 'provas', 'oab');
const outDir = path.join(root, 'assets', 'explanations');
const outFile = path.join(outDir, 'oab.json');
const batchFile = path.join(outDir, 'oab.batches.json');

const API = 'https://api.anthropic.com/v1';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set (use node --env-file=<file>).');
  process.exit(1);
}

const SYSTEM = `Você é professor de um cursinho preparatório para o Exame de Ordem (OAB) e escreve o comentário de questões objetivas da 1ª fase para os alunos.

Recebe a questão, as alternativas e o gabarito oficial da FGV. O gabarito oficial é a referência: explique por que a alternativa indicada está correta.

O comentário deve:
- começar dizendo qual é a alternativa correta e o fundamento principal (lei, artigo, súmula ou tese), em linguagem clara;
- citar os dispositivos legais, súmulas e entendimentos dos tribunais superiores com precisão. Se não tiver certeza do número de um artigo, cite a lei sem o número; nunca invente artigos, súmulas ou julgados;
- explicar em seguida, de forma breve, por que cada uma das outras alternativas está errada;
- ter entre 120 e 300 palavras, em parágrafos curtos separados por uma linha em branco, sem markdown, títulos ou listas;
- não mencionar que foi escrito por IA, não repetir o enunciado e não comentar a disciplina em que a questão foi classificada.

A prova foi aplicada no ano informado. Se a legislação ou a jurisprudência mudou depois disso de um modo que mudaria a resposta ou o fundamento (por exemplo, o CPC de 2015, a Reforma Trabalhista de 2017, o Pacote Anticrime, a Lei 14.133/2021, a EC 103/2019), explique a questão segundo o direito da época e descreva a mudança em "update_note".

Se você concluir que o gabarito oficial está errado ou que a questão não tem resposta correta, explique mesmo assim o raciocínio da banca e marque "agrees_with_key" como false.`;

const SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string', description: 'O comentário, em português.' },
    update_note: {
      type: ['string', 'null'],
      description: 'Se a lei ou a jurisprudência mudou desde a prova, o que mudou e como fica a resposta hoje; senão null.',
    },
    agrees_with_key: { type: 'boolean', description: 'false se o gabarito oficial parece errado.' },
    confidence: { type: 'string', enum: ['alta', 'media', 'baixa'] },
  },
  required: ['explanation', 'update_note', 'agrees_with_key', 'confidence'],
  additionalProperties: false,
};

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 1) + '\n');
}

/** Every question that can be explained: has an answer key and isn't held for review. */
async function loadQuestions() {
  const questions = [];
  for (const file of (await readdir(examDir)).filter((f) => f.endsWith('.json')).sort()) {
    const { exam_metadata: exam, questions: list } = JSON.parse(await readFile(path.join(examDir, file), 'utf8'));
    for (const q of list) {
      if (!q.correct_answer || q.review) continue;
      questions.push({ ...q, exam });
    }
  }
  return questions;
}

function promptFor(q) {
  const lines = [`Exame: ${q.exam.exam_name.trim()} (${q.exam.year})`, `Disciplina: ${q.subject ?? 'não informada'}`, ''];
  for (const t of q.context_texts ?? []) {
    lines.push([t.title, t.content, t.source].filter(Boolean).join('\n'), '');
  }
  lines.push(q.statement.trim(), '');
  for (const o of q.options) lines.push(`(${o.letter}) ${o.text.trim()}`);
  lines.push('', `Gabarito oficial: ${q.correct_answer}`);
  return lines.join('\n');
}

function requestFor(q) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: promptFor(q) }],
  };
}

function parseMessage(message) {
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (message.stop_reason !== 'end_turn' || !text) throw new Error(`stop_reason ${message.stop_reason}`);
  return JSON.parse(text);
}

/** N questions spread across subjects (round robin) and, within each, across exams. */
function sample(questions, n) {
  const hash = (s) => createHash('sha1').update(s).digest('hex');
  const bySubject = new Map();
  for (const q of [...questions].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) {
    const list = bySubject.get(q.subject) ?? [];
    list.push(q);
    bySubject.set(q.subject, list);
  }
  const lists = [...bySubject.values()].sort((a, b) => b.length - a.length);
  const picked = [];
  for (let i = 0; picked.length < n; i++) {
    const before = picked.length;
    for (const list of lists) if (list[i] && picked.length < n) picked.push(list[i]);
    if (picked.length === before) break;
  }
  return picked;
}

const [command, ...args] = process.argv.slice(2);
const done = await readJson(outFile, {});
const batches = await readJson(batchFile, []);

if (command === 'try') {
  const q = (await loadQuestions()).find((x) => x.id === args[0]);
  if (!q) throw new Error(`No explainable question ${args[0]}`);
  console.log(promptFor(q), '\n---');
  const message = await (await api('POST', '/messages', requestFor(q))).json();
  console.log(parseMessage(message), message.usage);
} else if (command === 'run' || command === 'submit') {
  const pending = (await loadQuestions()).filter((q) => !done[q.id] && !batches.some((b) => !b.collected && b.ids.includes(q.id)));
  const chosen = args[0] === '--all' ? pending : args[0] === '--sample' ? sample(pending, Number(args[1])) : null;
  if (!chosen) throw new Error(`${command} needs --sample N or --all`);
  if (!chosen.length) {
    console.log('Nothing to do.');
  } else if (command === 'run') {
    const usage = { input: 0, output: 0 };
    const failed = [];
    const queue = [...chosen];
    const worker = async () => {
      for (let q; (q = queue.shift()); ) {
        try {
          const message = await (await api('POST', '/messages', requestFor(q))).json();
          usage.input += message.usage.input_tokens;
          usage.output += message.usage.output_tokens;
          done[q.id] = { ...parseMessage(message), model: MODEL, generated_at: new Date().toISOString().slice(0, 10) };
          process.stdout.write('.');
        } catch (error) {
          failed.push(`${q.id} (${error.message.slice(0, 200)})`);
          process.stdout.write('x');
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await writeJson(outFile, Object.fromEntries(Object.entries(done).sort(([a], [b]) => a.localeCompare(b))));
    const cost = (2 * (usage.input * PRICE.input + usage.output * PRICE.output)) / 1e6;
    console.log(`\n${chosen.length - failed.length} saved, ${failed.length} failed, ${usage.input} in / ${usage.output} out tokens ≈ $${cost.toFixed(2)}`);
    if (failed.length) console.log('  failed:', failed.join(', '));
  } else {
    const requests = chosen.map((q) => ({ custom_id: q.id, params: requestFor(q) }));
    const batch = await (await api('POST', '/messages/batches', { requests })).json();
    batches.push({ id: batch.id, submitted_at: batch.created_at, ids: chosen.map((q) => q.id), collected: false });
    await writeJson(batchFile, batches);
    console.log(`Submitted ${batch.id} with ${chosen.length} questions.`);
  }
} else if (command === 'status') {
  for (const b of batches) {
    const info = await (await api('GET', `/messages/batches/${b.id}`)).json();
    console.log(b.id, info.processing_status, info.request_counts, b.collected ? 'collected' : '');
  }
} else if (command === 'collect') {
  for (const b of batches.filter((x) => !x.collected)) {
    const info = await (await api('GET', `/messages/batches/${b.id}`)).json();
    if (info.processing_status !== 'ended') {
      console.log(b.id, info.processing_status, info.request_counts);
      continue;
    }
    const usage = { input: 0, output: 0 };
    const failed = [];
    const body = await (await api('GET', info.results_url)).text();
    for (const line of body.split('\n').filter(Boolean)) {
      const { custom_id: id, result } = JSON.parse(line);
      try {
        if (result.type !== 'succeeded') throw new Error(result.type);
        usage.input += result.message.usage.input_tokens;
        usage.output += result.message.usage.output_tokens;
        done[id] = { ...parseMessage(result.message), model: MODEL, generated_at: info.ended_at.slice(0, 10) };
      } catch (error) {
        failed.push(`${id} (${error.message})`);
      }
    }
    b.collected = true;
    b.usage = usage;
    b.failed = failed;
    const cost = (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6;
    console.log(`${b.id}: ${b.ids.length - failed.length} saved, ${failed.length} failed, ` +
      `${usage.input} in / ${usage.output} out tokens ≈ $${cost.toFixed(2)}`);
    if (failed.length) console.log('  failed:', failed.join(', '));
  }
  await writeJson(outFile, Object.fromEntries(Object.entries(done).sort(([a], [b]) => a.localeCompare(b))));
  await writeJson(batchFile, batches);
} else {
  console.error('Commands: try <id> | run|submit --sample N | run|submit --all | status | collect');
  process.exit(1);
}
