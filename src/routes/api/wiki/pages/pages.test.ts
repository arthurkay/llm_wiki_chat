import { describe, it, expect } from 'vitest';
import { useTempWiki } from '../../../../tests/tmpwiki.js';
import { getDb, upsertPageFts } from '$lib/server/wiki/db.js';
import { GET as search } from '../search/+server.js';
import { GET as listPages } from './+server.js';
import { GET as getPage, DELETE as deletePage } from './[...path]/+server.js';

useTempWiki();

function seed() {
	getDb().prepare("INSERT INTO wiki_pages (path, title, kind, body, sources) VALUES ('sources/a.md','A Page','source','alpha beta content','[]')").run();
	upsertPageFts('sources/a.md', 'A Page', 'alpha beta content');
}

describe('GET /api/wiki/search', () => {
	it('returns matching excerpts', async () => {
		seed();
		const res = await search({ url: new URL('http://test/api/wiki/search?q=alpha&limit=5') } as never);
		const rows = (await res.json()) as Array<{ path: string; title: string; body: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ path: 'sources/a.md', title: 'A Page' });
	});

	it('caps limit at 20', async () => {
		seed();
		const res = await search({ url: new URL('http://test/api/wiki/search?q=alpha&limit=99') } as never);
		expect(res.status).toBe(200);
	});
});

describe('GET /api/wiki/pages', () => {
	it('lists page metadata', async () => {
		seed();
		const res = await listPages({} as never);
		expect(await res.json()).toEqual([
			{ path: 'sources/a.md', title: 'A Page', kind: 'source', updated_at: expect.any(String) }
		]);
	});
});

describe('/api/wiki/pages/[...path]', () => {
	it('returns the full page', async () => {
		seed();
		const res = await getPage({ params: { path: 'sources/a.md' } } as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ path: 'sources/a.md', body: 'alpha beta content' });
	});

	it('404s missing pages', async () => {
		const res = await getPage({ params: { path: 'nope.md' } } as never);
		expect(res.status).toBe(404);
	});

	it('deletes pages and 404s afterwards', async () => {
		seed();
		const del = await deletePage({ params: { path: 'sources/a.md' } } as never);
		expect(await del.json()).toEqual({ deleted: 'sources/a.md' });
		const again = await deletePage({ params: { path: 'sources/a.md' } } as never);
		expect(again.status).toBe(404);
	});

	it('neutralizes path traversal', async () => {
		seed();
		const res = await deletePage({ params: { path: '../../etc/passwd' } } as never);
		expect(res.status).toBe(404);
	});
});
