# AGENTS.md — llm_wiki_chat

> This repo is a real-world implementation of **Andrej Karpathy's llm_wiki
> pattern**: instead of re-deriving answers from raw chunks on every query
> (RAG), an LLM **compiles sources once** into a persistent, interlinked wiki
> and keeps it current. The mapping is exact:
>
> | Karpathy layer | Here |
> |---|---|
> | Raw sources (immutable, LLM reads only) | `data/raw/` |
> | Wiki (LLM-owned Markdown: summaries, entities, concepts, `index.md`, `log.md`, `[[wikilinks]]`) | `data/wiki/` |
> | Schema (rules + workflows co-evolved with the LLM) | `data/schema.md` |
>
> | Karpathy operation | Here |
> |---|---|
> | Ingest (read source → write/refresh pages → update index + log) | worker in `src/lib/server/wiki/ingest.ts` via `opencode serve` |
> | Query (search wiki → read pages → synthesize with citations) | `src/lib/server/wiki/query.ts` (FTS5 BM25 + one-hop link expansion) + `/api/chat/stream` |
> | Lint (broken links, orphans, contradictions reported, never silently rewritten) | convention enforced in `data/schema.md` |

## 1. What this software is

A multi-user, local-first **llm_wiki** knowledge base with chat — not RAG.
One shared wiki and one shared `opencode serve` backend; many browsers chat
against it. A single admin curates the wiki. Chat + wiki reading are public;
everything that mutates the knowledge base or reveals admin state requires the
admin password (`ADMIN_PASSWORD` env var, see §6).

Raw documents are **compiled once** into a persistent, interlinked Markdown wiki;
chat answers are grounded in that wiki, never re-derived from raw chunks.

Three layers (Karpathy pattern):

- `data/raw/` — immutable uploads (PDF, Markdown, text). The LLM reads, never writes.
- `data/wiki/` — LLM-owned Markdown vault (`sources/`, `entities/`, `concepts/`, `analyses/`, plus `index.md`, `log.md`). Obsidian-compatible.
- `data/schema.md` + `data/wiki.db` — maintainer rules and the sqlite operational store.

Core flows:

- **Ingest:** upload → sqlite `sources` + `ingest_jobs` (queued) → worker parses, calls
  `opencode serve` (2-step: analyze → generate pages), writes Markdown atomically,
  indexes FTS5, updates `index.md`/`log.md`. Falls back to deterministic pages offline.
- **Query:** FTS5 BM25 + one-hop `[[wikilink]]` expansion → context injected under the
  admin-configured system prompt → streamed reply with citations + reasoning trace.
- **Lint (convention):** broken links, orphans, contradictions are reported, never silently rewritten.

## 2. Stack and boundaries

- **App:** SvelteKit 2 + Svelte 5 runes, TypeScript, Tailwind v4, shadcn-svelte style
  primitives in `src/lib/components/ui/`, lucide icons, `mode-watcher` theming.
- **LLM backend:** external `opencode serve` REST API (default `http://127.0.0.1:4096`,
  override `OPENCODE_API_URL`). Session/message/event-bus endpoints only — never assume
  new endpoints; probe them first.
- **Storage:** `node:sqlite` (zero native deps), WAL mode, FTS5. No Postgres, no vectors,
  no Redis, no ORMs. The old Go backend is deleted and must not return.
- **Upload policy** (`src/lib/uploads.ts`, single source of truth): max **20MB**,
  extensions **.pdf, .md, .markdown, .txt, .text** only. Server enforces; UI pre-checks.

## 6. Multi-user model and admin auth

- Chat history is per-browser: the client registers the session ids it started
  (`wiki.sessions` in localStorage) and `/api/chat` only returns those — one
  browser can never list another's chats.
- Admin protection is on when `ADMIN_PASSWORD` is set (required for any shared
  deployment; unset means open, local-dev only).
- Auth is a stateless HMAC cookie (`src/lib/server/wiki/adminauth.ts`, `src/hooks.server.ts`):
  password is timing-safe-compared, cookie is `httpOnly` + `SameSite=lax`.
- Gated (401 without cookie): `GET /api/documents`, `/api/documents/:id`,
  `/api/jobs*`, `/api/settings*`, `DELETE /api/wiki/pages/*`.
  Always public: `/api/admin/*`, `/api/chat*`, `POST /api/documents` (any chat
  user may contribute sources), `GET /api/wiki/search`, `GET /api/wiki/pages*`.
  The `/admin` page renders always and shows a lock screen when gated.
- Never log or return the password. Never commit it. Cookie lifetime is 30 days.
- Chat answers run read-only by default: the app can pin every chat message to
  a deny-all opencode agent via the `chat_agent` setting (`parseAgent()` in
  `src/lib/server/wiki/settings.ts`, `CHAT_AGENT` in `opencode.ts`). The agent
  itself is defined server-side in `opencode.json` (`wiki-readonly`, `mode:
  primary`, `permission: {"*": "deny"}` — deny, never ask: headless serve would
  stall on prompts). Empty `chat_agent` = server-default agent (current
  behavior). Caveat, verified live: backends can reject restricted agents
  (opencode free tier returns 403) — the app fails closed with a clear error,
  never silently falls back. The ingest worker never sends `agent` (stays
  read-write by design).

## 3. Repo layout

- `src/routes/` — `/chat`, `/admin`, `/api/*` (`documents`, `jobs`, `wiki`, `chat`, `chat/stream`, `settings`)
- `src/lib/server/wiki/` — `db.ts` (schema + migrations), `opencode.ts` (REST + SSE streaming),
  `ingest.ts` (worker + deletes), `query.ts` (FTS5 retrieval), `settings.ts`, `models.ts`
- `src/lib/` — `uploads.ts`, `api/wiki.ts` (fetch client), `stores/wikiChat.ts`, `utils.ts` (`cn()`)
- `src/tests/` — `tmpwiki.ts` (fresh sqlite per test), `stubserver.ts` (stub opencode)
- Tests colocate with source as `*.test.ts`. Run: `npm test`, `npm run test:coverage`, `npm run check`.

## 4. Database (sqlite, `data/wiki.db`)

`sources`, `wiki_pages` (+ `wiki_pages_fts`), `ingest_jobs`, `chat_sessions`
(+ `opencode_session_id`), `chat_messages` (+ `citations`, `thinking` JSON/text),
`settings` (`chat_model`, `system_prompt`). Schema changes ship as
`ALTER TABLE … ADD COLUMN` migrations inside `getDb()` — never break existing databases.

## 5. Agent working agreements (non-negotiable)

1. **Validation over assumption.** Read the exact file/lines before editing. Reproduce a
   bug (failing test or live request) before fixing it. Verify every change by executing
   it: `npm run check`, targeted tests, then the full suite. Never claim "done" from reading alone.
2. **Correctness over speed.** Prefer the boring, obviously-right implementation. Handle
   error paths, empty states, timeouts and races explicitly. No silent failures, no
   fire-and-forget without a recorded outcome (job rows, logs, or UI status).
3. **Clean, human-readable code.** Small functions with one job; plain names; no clever
   one-liners, no dead code, no commented-out blocks. UI follows existing shadcn
   primitives and theme tokens — no inline color hacks, no new component library.
   Mobile first: `min-w-0` on flex children, `break-all` on paths/code, `h-dvh` layouts.
4. **High test coverage.** Every behavior change ships with tests; target ≥90% statements
   on `src/lib` and all API routes. Prefer deterministic stubs over live services
   (`stubserver.ts`, dead-port base for offline paths). A red suite blocks everything else.
5. **No scope creep.** Touch only what the task requires. No new dependencies without a
   stated reason. No schema change without a migration. No UI text that contradicts
   `uploads.ts` limits. Confirm destructive actions (deletes, history rewrites) before running.
