import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { startOpencodeStub, type SeenRequest } from '../../../tests/stubserver.js';
import { getDb, getRawDir, getWikiDir } from '$lib/server/wiki/db.js';
import { getOpencodeBase, setOpencodeBase } from '$lib/server/wiki/opencode.js';
import {
	slugify,
	today,
	extractText,
	deterministicPages,
	refreshIndexAndOverview,
	removeWikiPage,
	removeSource,
	processPendingJobs,
	isRunAborted,
	requeueFailedJobs
} from '$lib/server/wiki/ingest.js';

useTempWiki();

let savedBase = '';
beforeEach(() => {
	savedBase = getOpencodeBase();
	// Point opencode at a dead port so the worker takes the deterministic path
	setOpencodeBase('http://127.0.0.1:1');
});
afterEach(() => setOpencodeBase(savedBase));

describe('slugify', () => {
	it.each([
		['Board member Declaration.pdf', 'board-member-declaration'],
		['  Weird___Name___.MD', 'weird-name'],
		['a'.repeat(100) + '.txt', 'a'.repeat(60)],
		['!!!', 'untitled']
	])('%s -> %s', (input, expected) => {
		expect(slugify(input)).toBe(expected);
	});
});

describe('today', () => {
	it('returns YYYY-MM-DD', () => {
		expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('extractText', () => {
	it('passes txt/md through with a size cap', () => {
		expect(extractText('n.txt', Buffer.from('hello'))).toBe('hello');
		const big = 'x'.repeat(70000);
		expect(extractText('n.md', Buffer.from(big))).toHaveLength(60000);
	});

	it('marks binary pdfs for review instead of crashing', () => {
		const out = extractText('form.pdf', Buffer.from('%PDF-1.4 garbage'));
		expect(typeof out).toBe('string');
		expect(out.length).toBeGreaterThan(0);
	});
});

describe('deterministicPages', () => {
	it('builds a review-flagged source page', () => {
		const [page] = deterministicPages('My Doc', 'my-doc.txt', 'Some body text here');
		expect(page.path).toBe('sources/my-doc.md');
		expect(page.kind).toBe('source');
		expect(page.body).toContain('my-doc.txt');
		expect(page.body).toContain('Some body text here');
		expect(page.body).toMatch(/needs_review/);
	});
});

describe('ingest worker', () => {
	function enqueue(filename: string, content: string): string {
		const id = randomUUID();
		const stored = `${id}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
		writeFileSync(join(getRawDir(), stored), content);
		getDb().prepare('INSERT INTO sources (id, filename, stored_name, file_type, file_size, sha256, status) VALUES (?,?,?,?,?,?,?)').run(
			id, filename, stored, 'txt', content.length, 'abc', 'queued'
		);
		const jobId = randomUUID();
		getDb().prepare('INSERT INTO ingest_jobs (id, source_id, status) VALUES (?,?,?)').run(jobId, id, 'queued');
		return id;
	}

	it('compiles a queued source into the wiki without an LLM', async () => {
		enqueue('wombats.txt', 'Wombats are marsupials. See [[Burrows]] for homes.');
		await processPendingJobs();
		const job = getDb().prepare('SELECT status FROM ingest_jobs').get() as { status: string };
		expect(job.status).toBe('done');
		const pages = getDb().prepare('SELECT path FROM wiki_pages').all() as Array<{ path: string }>;
		expect(pages.map((p) => p.path)).toEqual(['sources/wombats.md']);
		expect(existsSync(join(getWikiDir(), 'index.md'))).toBe(true);
		const index = readFileSync(join(getWikiDir(), 'index.md'), 'utf-8');
		expect(index).toContain('sources/wombats.md');
	});

	it('marks missing files as failed instead of crashing', async () => {
		const id = randomUUID();
		getDb().prepare("INSERT INTO sources (id, filename, file_type, sha256) VALUES (?, 'gone.txt', 'txt', 'x')").run(id);
		getDb().prepare('INSERT INTO ingest_jobs (id, source_id, status) VALUES (?,?,?)').run(randomUUID(), id, 'queued');
		await processPendingJobs();
		const job = getDb().prepare('SELECT status, error FROM ingest_jobs').get() as { status: string; error: string };
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/ENOENT|no such file/i);
	});

	it('removes a single page with index + log updates', async () => {
		enqueue('solo.txt', 'solo content');
		await processPendingJobs();
		expect(removeWikiPage('sources/solo.md', 'test')).toBe(true);
		expect(removeWikiPage('sources/solo.md', 'test')).toBe(false);
		expect(existsSync(join(getWikiDir(), 'sources/solo.md'))).toBe(false);
		const n = (getDb().prepare('SELECT COUNT(*) AS n FROM wiki_pages').get() as { n: number }).n;
		expect(n).toBe(0);
	});

	it('removes a source with its exclusive pages but keeps shared ones', async () => {
		const id = enqueue('shared.txt', 'shared content here');
		await processPendingJobs();
		// Simulate a second source enriching the same entity page
		getDb().prepare("UPDATE wiki_pages SET sources = ? WHERE path = 'sources/shared.md'").run(
			JSON.stringify(['shared.txt', 'other.txt'])
		);
		const result = removeSource(id);
		expect(result.pages).toEqual([]);
		const remaining = getDb().prepare('SELECT path FROM wiki_pages').all() as Array<{ path: string }>;
		expect(remaining.map((p) => p.path)).toEqual(['sources/shared.md']);
	});

	it('throws for unknown sources', () => {
		expect(() => removeSource('nope')).toThrow(/not found/);
	});

	it('refreshIndexAndOverview renders the catalog', async () => {
		enqueue('cat.txt', 'cats');
		await processPendingJobs();
		refreshIndexAndOverview();
		const index = readFileSync(join(getWikiDir(), 'index.md'), 'utf-8');
		expect(index).toMatch(/^# Wiki index/);
		expect(index).toContain('sources/cat.md');
	});

	it('detects runs aborted by mid-run deletes', () => {
		const db = getDb();
		db.prepare("INSERT INTO sources (id, filename, file_type, sha256) VALUES ('s1','a.txt','txt','x')").run();
		db.prepare("INSERT INTO ingest_jobs (id, source_id, status) VALUES ('j1','s1','processing')").run();
		db.prepare("INSERT INTO ingest_jobs (id, source_id, status) VALUES ('j2','s1','queued')").run();
		expect(isRunAborted(db, 's1', 'j1')).toBe(false);
		expect(isRunAborted(db, 's1', 'j2')).toBe(true); // wrong status
		expect(isRunAborted(db, 'missing', 'j1')).toBe(true); // source gone
		expect(isRunAborted(db, 's1', 'missing')).toBe(true); // job gone
	});

	it('requeues failed jobs and resets their sources', () => {
		const db = getDb();
		db.prepare("INSERT INTO sources (id, filename, file_type, sha256, status) VALUES ('s1','a.txt','txt','x','failed')").run();
		db.prepare("INSERT INTO ingest_jobs (id, source_id, status, error) VALUES ('j1','s1','failed','opencode: boom')").run();
		db.prepare("INSERT INTO sources (id, filename, file_type, sha256, status) VALUES ('s2','b.txt','txt','x','failed')").run();
		db.prepare("INSERT INTO ingest_jobs (id, source_id, status, error) VALUES ('j2','s2','failed','opencode: boom')").run();
		expect(requeueFailedJobs('j1')).toEqual(['j1']);
		expect(db.prepare("SELECT status, error FROM ingest_jobs WHERE id='j1'").get()).toMatchObject({ status: 'queued', error: null });
		expect(db.prepare("SELECT status FROM sources WHERE id='s1'").get()).toMatchObject({ status: 'queued' });
		expect(requeueFailedJobs()).toEqual(['j2']);
		expect(() => requeueFailedJobs('missing')).toThrow(/not found/);
		expect(() => requeueFailedJobs('j1')).toThrow(/only failed jobs/);
	});

	it('runs LLM ingest without requesting any agent (worker stays default)', async () => {
		const seen: SeenRequest[] = [];
		let messageCalls = 0;
		await startOpencodeStub(
			{
				'GET /global/health': () => ({ json: { healthy: true } }),
				'POST /session': () => ({ json: { id: 'ses_ing', title: 't' } }),
				'POST /session/ses_ing/message': () => {
					messageCalls += 1;
					const text =
						messageCalls === 1
							? 'Analysis: key takeaways, entities, concepts. No braces here.'
							: JSON.stringify({
									pages: [{ path: 'sources/llm.md', title: 'LLM Doc', kind: 'source', body: '# LLM Doc\n\nCompiled.' }]
								});
					return { json: { info: {}, parts: [{ type: 'text', text }] } };
				}
			},
			seen
		);
		enqueue('llm.txt', 'content for the language model');
		await processPendingJobs();
		const job = getDb().prepare('SELECT status FROM ingest_jobs').get() as { status: string };
		expect(job.status).toBe('done');
		// Proves the LLM path ran (not the deterministic fallback)
		const page = getDb().prepare('SELECT body FROM wiki_pages WHERE path = ?').get('sources/llm.md') as { body: string };
		expect(page.body).toContain('Compiled.');
		// Worker must not request (or inherit) any agent — read-only is chat-only
		const messageBodies = seen
			.filter((r) => r.url === '/session/ses_ing/message')
			.map((r) => JSON.parse(r.body));
		expect(messageBodies).toHaveLength(2);
		for (const body of messageBodies) {
			expect(body).not.toHaveProperty('agent');
		}
	});
});
