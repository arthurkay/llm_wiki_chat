import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { getDb, getDataDir, getRawDir, getWikiDir, upsertPageFts, deletePageFts, configureWikiPaths } from '$lib/server/wiki/db.js';

useTempWiki();

describe('wiki storage layout', () => {
	it('creates data/raw/wiki subdirectories', () => {
		expect(existsSync(getRawDir())).toBe(true);
		expect(existsSync(join(getWikiDir(), 'sources'))).toBe(true);
		expect(existsSync(join(getWikiDir(), 'entities'))).toBe(true);
		expect(existsSync(join(getWikiDir(), 'concepts'))).toBe(true);
		expect(existsSync(join(getWikiDir(), 'analyses'))).toBe(true);
	});

	it('repoints cleanly at a new directory', () => {
		const first = getDataDir();
		getDb().prepare("INSERT INTO sources (id, filename, file_type, sha256) VALUES ('a','a.txt','txt','x')").run();
		configureWikiPaths(join(first, '..', 'wiki-test-repoint'));
		expect(getDataDir()).not.toBe(first);
		// old data is gone with the old dir
		expect(getDb().prepare('SELECT COUNT(*) AS n FROM sources').get()).toMatchObject({ n: 0 });
	});
});

describe('schema', () => {
	it('creates all tables and the fts index', () => {
		const tables = getDb()
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name")
			.all() as Array<{ name: string }>;
		const names = tables.map((t) => t.name);
		for (const t of ['sources', 'wiki_pages', 'wiki_pages_fts', 'ingest_jobs', 'chat_sessions', 'chat_messages', 'settings']) {
			expect(names).toContain(t);
		}
	});

	it('migrates stored_name and thinking columns onto legacy databases', async () => {
		const { DatabaseSync } = await import('node:sqlite');
		const { mkdtempSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const dir = mkdtempSync(join(tmpdir(), 'wiki-legacy-'));
		const legacy = new DatabaseSync(join(dir, 'wiki.db'));
		legacy.exec(
			'CREATE TABLE sources (id TEXT PRIMARY KEY, filename TEXT, file_type TEXT);' +
				'CREATE TABLE chat_messages (id TEXT PRIMARY KEY, content TEXT);'
		);
		legacy.close();
		configureWikiPaths(dir);
		const srcCols = getDb().prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>;
		expect(srcCols.map((c) => c.name)).toContain('stored_name');
		const msgCols = getDb().prepare('PRAGMA table_info(chat_messages)').all() as Array<{ name: string }>;
		expect(msgCols.map((c) => c.name)).toContain('thinking');
	});
});

describe('fts helpers', () => {
	it('upserts and deletes fts rows', () => {
		getDb().prepare("INSERT INTO wiki_pages (path, title, kind, body) VALUES ('s/a.md','A','source','hello world')").run();
		upsertPageFts('s/a.md', 'A', 'hello world');
		let hits = getDb().prepare('SELECT path FROM wiki_pages_fts WHERE wiki_pages_fts MATCH ?').all('hello') as Array<{ path: string }>;
		expect(hits.map((h) => h.path)).toEqual(['s/a.md']);

		upsertPageFts('s/a.md', 'A', 'completely different words');
		hits = getDb().prepare('SELECT path FROM wiki_pages_fts WHERE wiki_pages_fts MATCH ?').all('hello') as Array<{ path: string }>;
		expect(hits).toEqual([]);

		deletePageFts('s/a.md');
		const count = getDb().prepare('SELECT COUNT(*) AS n FROM wiki_pages_fts').get() as { n: number };
		expect(count.n).toBe(0);
	});
});
