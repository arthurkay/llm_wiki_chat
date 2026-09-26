# Wiki schema — co-evolved with the LLM maintainer

> This vault implements **Andrej Karpathy's llm_wiki pattern**: raw sources are
> compiled once into this persistent, interlinked wiki (not re-derived per query),
> and this schema is the rules document the pattern calls for — maintained jointly
> by human and LLM as the domain understanding grows.

Three layers:
- `data/raw/` — immutable sources (you write, LLM only reads). pdf/txt/md.
- `data/wiki/` — LLM-owned markdown (LLM writes, you read). Never hand-edit except
  `conventions.md` preferences; human overrides win on conflict and are logged.
- This file — the rules. Update it as we learn what works for this domain.

## Page types

- `wiki/index.md` — content catalog: every page, one-line summary, category.
  Updated on every ingest. Entry point for query navigation at small scale.
- `wiki/log.md` — append-only operations log. Prefix: `## [YYYY-MM-DD] <ingest|query|lint> | <title>`.
- `wiki/overview.md` — global synthesis, refreshed as the corpus grows.
- `wiki/sources/<slug>.md` — one per raw source. YAML frontmatter with
  `type, title, sources: [<raw filename>]`, summary, key takeaways, wikilinks.
- `wiki/entities/*.md` — people, orgs, tools. One page per entity, accumulated
  across sources (never orphan duplicates). Frontmatter `sources: []` traces provenance.
- `wiki/concepts/*.md` — theories, methods, patterns.
- `wiki/analyses/*.md` — valuable query answers filed back so exploration compounds.

Every page: YAML frontmatter + `[[wikilink]]` cross-references + `sources: []` traceability.
Obsidian-compatible vault layout.

## Workflows

### Ingest (one source at a time, human stays involved)
1. Read raw source fully. Discuss key takeaways.
2. Write/refresh `sources/<slug>.md` summary.
3. Extract/merge entities + concepts (dedupe by meaning, not filename).
4. Update `index.md`, append `log.md`, refresh `overview.md` when warranted.
5. Record contradictions explicitly: what new data challenges, with citations.

### Query (against the wiki, not raw docs)
1. Read `index.md`, FTS5-search wiki pages for relevant candidates.
2. Read top pages, follow `[[wikilinks]]` one hop for connected context.
3. Synthesize answer with citations (`wiki/...` paths).
4. File valuable answers back into `wiki/analyses/`.

### Lint
Detect: broken `[[links]]`, orphan pages, frontmatter errors, thin pages,
contradictions / stale claims. Report, don't silently rewrite human overrides.

## Conventions

- One source may touch many pages; keep each edit surgical.
- Prefer small durable pages over trivia dumps (atom granularity matters).
- Never modify `data/raw/`. Never lose human edits on regen — merge.
