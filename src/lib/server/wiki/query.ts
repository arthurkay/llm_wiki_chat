import { getDb } from './db.js';

export interface WikiHit {
	path: string;
	title: string;
	body: string;
	rank: number;
	sources: string;
}

function ftsQuery(q: string): string {
	// Conservative FTS5 query: quoted phrases OR'd over significant tokens
	const tokens = q
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 2)
		.slice(0, 12);
	if (tokens.length === 0) return '';
	return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export function searchWiki(query: string, limit = 5): WikiHit[] {
	const db = getDb();
	const match = ftsQuery(query);
	if (!match) {
		const rows = db
			.prepare('SELECT path, title, body, sources FROM wiki_pages ORDER BY updated_at DESC LIMIT ?')
			.all(limit) as unknown as WikiHit[];
		return rows.map((r) => ({ ...r, rank: 0 }));
	}
	try {
		const rows = db
			.prepare(
				`SELECT f.path AS path, f.title AS title, p.body AS body, p.sources AS sources, rank AS rank
				 FROM wiki_pages_fts f JOIN wiki_pages p ON p.path = f.path
				 WHERE wiki_pages_fts MATCH ? ORDER BY rank LIMIT ?`
			)
			.all(match, limit) as unknown as WikiHit[];
		return rows;
	} catch {
		return [];
	}
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

export function expandWikilinks(hits: WikiHit[], perHit = 2): WikiHit[] {
	const db = getDb();
	const seen = new Set(hits.map((h) => h.path));
	const extra: WikiHit[] = [];
	for (const h of hits) {
		WIKILINK.lastIndex = 0;
		let m: RegExpExecArray | null;
		let n = 0;
		while ((m = WIKILINK.exec(h.body)) !== null && n < perHit) {
			const name = m[1].trim();
			const row = db
				.prepare(
					'SELECT path, title, body, sources FROM wiki_pages WHERE title = ? OR path LIKE ? LIMIT 1'
				)
				.get(name, `%${name}%`) as unknown as WikiHit | undefined;
			if (row && !seen.has(row.path)) {
				seen.add(row.path);
				extra.push({ ...row, rank: 0 });
				n++;
			}
		}
	}
	return [...hits, ...extra];
}

export function retrieveWikiContext(query: string, limit = 5): WikiHit[] {
	return expandWikilinks(searchWiki(query, limit));
}

/**
 * User-facing citations: source document names users recognize, deduped in
 * relevance order. Falls back to the internal wiki path when a page has no
 * recorded provenance.
 */
export function pageCitations(pages: WikiHit[]): string[] {
	const out: string[] = [];
	for (const p of pages) {
		let from: string[] = [];
		try {
			const parsed: unknown = JSON.parse(p.sources ?? '[]');
			if (Array.isArray(parsed)) from = parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
		} catch {
			// fall through to path fallback
		}
		if (from.length === 0) from = [p.path];
		for (const f of from) {
			if (!out.includes(f)) out.push(f);
		}
	}
	return out;
}

export function buildWikiContext(pages: WikiHit[]): string {
	if (pages.length === 0) return '(wiki empty — no compiled pages yet)';
	return pages
		.map((p) => `### ${p.title} [${p.path}]\n${p.body.slice(0, 3000)}`)
		.join('\n\n---\n\n');
}

export function listPages(limit = 100): Array<{ path: string; title: string; kind: string; updated_at: string }> {
	return getDb()
		.prepare('SELECT path, title, kind, updated_at FROM wiki_pages ORDER BY updated_at DESC LIMIT ?')
		.all(limit) as unknown as Array<{ path: string; title: string; kind: string; updated_at: string }>;
}
