# Wiki Chat

Personal llm_wiki knowledge base with chat. Upload documents (pdf/txt/md) from any
device on the LAN; a worker compiles them into a persistent Markdown wiki via an
`opencode serve` backend; chat answers stream back with citations and reasoning.

## Run

Requires `opencode serve` reachable (default `http://127.0.0.1:4096`, override with
`OPENCODE_API_URL`).

```sh
npm install
npm run dev -- --port 5173 --host 0.0.0.0
```

Open `http://<host>:5174/chat`, manage sources at `/admin`.

## Tests

```sh
npm test              # unit + route + component tests (vitest)
npm run test:coverage # with coverage report (~91% statements)
npm run check         # svelte + type checks
```

## Layout

- `src/routes/` — `/chat`, `/admin`, `/api/*` (documents, jobs, wiki, chat/stream, settings)
- `src/lib/server/wiki/` — sqlite store, opencode REST client, ingest worker, FTS5 retrieval
- `data/` — `wiki.db` (sqlite), `raw/` (immutable uploads), `wiki/` (generated vault), `schema.md` (maintainer rules)
