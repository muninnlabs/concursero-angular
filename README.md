# BrasilQuiz (web)

Angular + Node version of the Concursero app: ENEM and OAB practice questions, simulados and stats.

```
client/   Angular 22 app (standalone components, signals, SCSS)
server/   Node 24 + Express API (TypeScript run natively by Node, no build step)
assets/   Exam data, same layout as the Flutter app
  provas/oab/*.json
  provas/enem/*.json
  images/            ← not committed (245 MB), see "Assets" below
mocks/    Design mocks the UI is based on
scripts/  sync-assets.mjs
```

## Running it

Requires Node 24+.

```bash
npm install && npm run install:all
npm run sync-assets -- ../path/to/concursero   # once, for question images
npm run dev                                     # API on :3000, app on http://localhost:4200
```

`npm test` runs the API tests (node:test) and the Angular tests (Vitest).

Copy `server/.env.example` to `server/.env` and set `JWT_SECRET`, otherwise every restart logs everyone out.

## What's stored where

| Data | Where | Why |
|---|---|---|
| Exams, questions, answer keys | JSON files in `assets/provas`, loaded into memory by the API at startup | Read-only, ~13 MB, already versioned in git. A database adds nothing. |
| Question images | `assets/images`, served by the API at `/assets/images/…` | Paths in the JSON (`assets/images/x.png`) work unchanged. |
| Users, answers, simulados | SQLite (`server/data/concursero.db`) | The only data that changes. |

All persistence goes through the `UserStore` interface (`server/src/users/store.ts`), so SQLite can be swapped for Postgres or Firestore without touching the routes.

The answer key never reaches the browser: the API strips `correct_answer` / `is_correct` from questions and grades submissions itself (`POST /api/answers`). For the same reason the exam JSON isn't served as static files.

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/catalog` | – | Totals per category |
| GET | `/api/exams?category=OAB` | – | Exam list (`path` = the Flutter asset path) |
| GET | `/api/exams/:examId` | – | Exam with questions (no answers) |
| GET | `/api/practice/questions?category=&subject=&count=` | – | Random gradable questions |
| POST | `/api/auth/register`, `/api/auth/login` | – | `{ token, user }` |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/answers` | ✓ | `{ answers: [{ questionId, selected }], simulado?: { title } }` → graded results |
| GET | `/api/me/stats?category=` | ✓ | Answered, correct, accuracy, streak, per subject |
| GET | `/api/me/simulados?limit=` | ✓ | Recent simulados |

## Assets

The exam files are copied from the Flutter repo with the same relative paths, so a question's `image_url` like `assets/images/enem_2023_cd7_q110-A.png` resolves the same in both apps. To refresh them after the Flutter pipeline changes:

```bash
npm run sync-assets -- ../path/to/concursero
```

Categories are the folder names under `assets/provas` (mapped in `server/src/exams/catalog.ts`). Questions without a valid A–E answer (annulled, or not parsed yet, e.g. ENEM 2010) are left out of practice and can't be graded.

## Not done yet

- Estatísticas, Assuntos, Perfil, Configurações and Ajuda are placeholder pages; search and notifications in the top bar aren't wired up.
- Premium / payments: the plan is stored per user (`free` / `premium`) but nothing sets it.
- The hero and phone images are crops of the mock; the "10.000+ simulados" and "95% de aprovação" figures on the landing page are the mock's placeholder numbers.
