import { describe, it, expect } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { getDb, upsertPageFts } from '$lib/server/wiki/db.js';
import { searchWiki, expandWikilinks, retrieveWikiContext, buildWikiContext, listPages, pageCitations, type WikiHit } from '$lib/server/wiki/query.js';

useTempWiki();

function seed() {
	const db = getDb();
	const pages = [
		{ path: 'sources/cats.md', title: 'Cats', kind: 'source', body: 'Cats are independent animals. See [[Dogs]] for contrast.' },
		{ path: 'sources/dogs.md', title: 'Dogs', kind: 'entity', body: 'Dogs are loyal companions.' },
		{ path: 'concepts/pets.md', title: 'Pets', kind: 'concept', body: 'Keeping pets teaches responsibility.' }
	];
	for (const p of pages) {
		db.prepare('INSERT INTO wiki_pages (path, title, kind, body, sources) VALUES (?, ?, ?, ?, ?)').run(
			p.path, p.title, p.kind, p.body, '[]'
		);
		upsertPageFts(p.path, p.title, p.body);
	}
}

describe('searchWiki', () => {
	it('finds pages by keyword with BM25 ranking', () => {
		seed();
		const hits = searchWiki('loyal companions', 5);
		expect(hits[0].path).toBe('sources/dogs.md');
	});

	it('returns latest pages when the query has no significant tokens', () => {
		seed();
		const hits = searchWiki('!!!', 2);
		expect(hits).toHaveLength(2);
	});

	it('returns empty when nothing matches', () => {
		seed();
		expect(searchWiki('xylophone quantum', 5)).toEqual([]);
	});
});

describe('expandWikilinks', () => {
	it('pulls in one-hop [[linked]] pages without duplicates', () => {
		seed();
		const hits = searchWiki('independent animals', 5);
		expect(hits.map((h) => h.path)).toContain('sources/cats.md');
		const expanded = expandWikilinks(hits);
		expect(expanded.map((h) => h.path)).toContain('sources/dogs.md');
		const paths = expanded.map((h) => h.path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('ignores links with no matching page', () => {
		seed();
		const expanded = expandWikilinks([{ path: 'x.md', title: 'X', body: 'See [[Nobody Here]] ok', rank: 0, sources: '[]' }]);
		expect(expanded).toHaveLength(1);
	});
});

describe('pageCitations', () => {
	const hit = (over: Partial<WikiHit>): WikiHit => ({ path: 'p.md', title: 'T', body: 'b', rank: 0, sources: '[]', ...over });

	it('cites source document names, deduped in order', () => {
		expect(
			pageCitations([
				hit({ path: 'sources/a.md', sources: JSON.stringify(['Board minutes.pdf', 'Policy.docx']) }),
				hit({ path: 'entities/x.md', sources: JSON.stringify(['Board minutes.pdf']) })
			])
		).toEqual(['Board minutes.pdf', 'Policy.docx']);
	});

	it('falls back to the wiki path without provenance', () => {
		expect(pageCitations([hit({ path: 'sources/a.md', sources: '[]' })])).toEqual(['sources/a.md']);
		expect(pageCitations([hit({ path: 'sources/a.md', sources: 'not-json' })])).toEqual(['sources/a.md']);
	});

	it('skips non-string entries', () => {
		expect(pageCitations([hit({ sources: JSON.stringify(['ok.pdf', 42, '']) })])).toEqual(['ok.pdf']);
	});
});

describe('retrieveWikiContext + buildWikiContext', () => {
	it('retrieves and formats context with citations', () => {
		seed();
		const pages = retrieveWikiContext('loyal companions', 3);
		expect(pages.length).toBeGreaterThan(0);
		const ctx = buildWikiContext(pages);
		expect(ctx).toMatch(/### Dogs \[sources\/dogs\.md\]/);
	});

	it('reports an empty wiki gracefully', () => {
		expect(buildWikiContext([])).toMatch(/empty/);
	});
});

describe('listPages', () => {
	it('lists newest first', () => {
		seed();
		const pages = listPages();
		expect(pages).toHaveLength(3);
		expect(pages[0]).toMatchObject({ path: expect.any(String), title: expect.any(String) });
	});
});
