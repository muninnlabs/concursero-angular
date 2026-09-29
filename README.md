# BrasilQuiz (web)

Angular version of the Concursero apps: ENEM and OAB practice questions, simulados and stats.
Test deployment: https://munninlabs.com/concursero-angular/

```
client/   Angular 22 app (standalone components, signals, SCSS)
server/   API in TypeScript (Hono): runs on Node locally and as a Cloudflare Worker
assets/   Exam data, same layout as the Flutter app
  provas/oab/*.json
  provas/enem/*.json
  images/            ← not committed (245 MB), see "Assets" below
mocks/    Design mocks the UI is based on
scripts/  sync-assets.mjs, build-cloudflare.mjs
```

## Running it locally

Requires Node 24+.

```bash
npm install && npm run install:all
npm run sync-assets -- ../path/to/concursero   # once, for question images
npm run dev                                     # API on :3000, app on http://localhost:4200
```

`npm test` runs the API tests (node:test) and the Angular tests (Vitest).

## Login

Google sign-in through **Firebase Authentication**, using the same Firebase project as the
mobile app (`concursero-8cc5b`), so it's the same account on web and phone. The browser sends
the Firebase ID token; the API verifies it against Google's public keys
(`server/src/auth/firebase.ts`) and keeps its own profile and stats per Firebase uid.

Every domain the app runs on must be listed in Firebase console › Authentication › Settings ›
**Authorized domains** (`localhost` is there by default; `munninlabs.com` must be added).

## What's stored where

| Data | Where | Why |
|---|---|---|
| Exams, questions, answer keys | JSON files in `assets/provas` | Read-only and versioned in git. A database adds nothing. |
| Question images | `assets/images` | Paths in the JSON (`assets/images/x.png`) work unchanged. |
| Users, answers, simulados | SQLite locally (`server/data/`), **D1** on Cloudflare | The only data that changes. Same SQL (`server/migrations`). |

Persistence goes through the `UserStore` interface (`server/src/users/store.ts`); exams through
`ExamSource` (`server/src/exams/catalog.ts`): in memory on Node, one file at a time on the Worker.

Grading happens on the server (`POST /api/answers`); the practice endpoints never include the
answer key. (On Cloudflare the exam JSON files are also public static assets. The keys are the
official, published gabaritos, so that's accepted.)

## Cloudflare

`wrangler.toml` deploys one Worker on the route `munninlabs.com/concursero-angular*` with the
Angular build, exams and images as static assets and a D1 database (`concursero-angular`).

```bash
npx wrangler login            # once
npm run deploy                # build dist-cf/, apply D1 migrations, deploy
```

Run the same Worker locally (local D1, no login needed):

```bash
npm run build:cloudflare
npx wrangler d1 migrations apply concursero-angular --local
npx wrangler dev              # http://127.0.0.1:8787/concursero-angular/
```

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/catalog` | – | Totals per category |
| GET | `/api/exams?category=OAB` | – | Exam list (`path` = the Flutter asset path) |
| GET | `/api/exams/:examId` | – | Exam with questions (no answers) |
| GET | `/api/practice/questions?category=&subject=&count=` | – | Random gradable questions |
| GET | `/api/auth/me` | ✓ | Profile (created on first sign-in) |
| POST | `/api/answers` | ✓ | `{ answers: [{ questionId, examId, selected }], simulado?: { title } }` → graded results |
| GET | `/api/me/stats?category=` | ✓ | Answered, correct, accuracy, streak, per subject |
| GET | `/api/me/simulados?limit=` | ✓ | Recent simulados |

On Cloudflare every path is prefixed with `/concursero-angular`.

## Assets

The exam files are copied from the Flutter repo with the same relative paths. To refresh them:

```bash
npm run sync-assets -- ../path/to/concursero
```

Questions without a valid A–E answer (annulled, or not parsed yet, e.g. ENEM 2010) are left out
of practice and can't be graded.

## Not done yet

- Estatísticas, Assuntos, Perfil, Configurações and Ajuda are placeholder pages; search and notifications aren't wired up.
- Web stats are separate from the phone's (the mobile app keeps its history on the device).
- Premium / payments: the plan is stored per user but nothing sets it.
- The landing page's "10.000+ simulados" and "95% de aprovação" are the mock's placeholder numbers.
