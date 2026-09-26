import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { getDb } from '$lib/server/wiki/db.js';
import { getOpencodeBase, setOpencodeBase } from '$lib/server/wiki/opencode.js';
import { GET, POST } from './+server.js';
import { DELETE as deleteSource } from './[id]/+server.js';

useTempWiki();

let savedBase = '';
beforeEach(() => {
	savedBase = getOpencodeBase();
	setOpencodeBase('http://127.0.0.1:1'); // deterministic worker path
});
afterEach(() => setOpencodeBase(savedBase));

function postFile(name: string, content: string, type = 'text/plain'): Request {
	const form = new FormData();
	form.append('file', new File([content], name, { type }));
	return new Request('http://test/api/documents', { method: 'POST', body: form });
}

async function waitForJobsDone(timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	for (;;) {
		const rows = getDb().prepare("SELECT status FROM ingest_jobs WHERE status IN ('queued','processing')").all();
		if (rows.length === 0) return;
		if (Date.now() - start > timeoutMs) throw new Error('jobs did not settle');
		await new Promise((r) => setTimeout(r, 100));
	}
}

describe('POST /api/documents', () => {
	it('rejects missing files', async () => {
		const res = await POST({ request: new Request('http://test/api/documents', { method: 'POST' }) } as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/empty or interrupted/i) });
	});

	it('rejects empty files with a device-actionable message', async () => {
		const form = new FormData();
		form.append('file', new File([], 'empty.pdf', { type: 'application/pdf' }));
		const res = await POST({ request: new Request('http://test/api/documents', { method: 'POST', body: form }) } as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/empty|download it to the device/i) });
	});

	it('rejects unsupported extensions', async () => {
		const res = await POST({ request: postFile('evil.exe', 'x') } as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/only PDF, Markdown and text/i) });
	});

	it('accepts markdown and text variants', async () => {
		for (const name of ['a.markdown', 'b.text']) {
			const res = await POST({ request: postFile(name, 'content here') } as never);
			expect(res.status).toBe(201);
		}
	});

	it('rejects files over 20MB', async () => {
		const big = 'x'.repeat(20 * 1024 * 1024 + 1);
		const res = await POST({ request: postFile('big.pdf', big, 'application/pdf') } as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/20MB max/) });
	});

	it('stores the upload and queues a job', async () => {
		const res = await POST({ request: postFile('notes.txt', 'hello wiki') } as never);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; job_id: string };
		expect(body.id).toBeTruthy();
		await waitForJobsDone();
		const src = getDb().prepare('SELECT status, stored_name FROM sources WHERE id = ?').get(body.id) as {
			status: string;
			stored_name: string;
		};
		expect(src.status).toBe('completed');
		expect(src.stored_name).toContain(body.id);
	});

	it('accepts raw octet-stream uploads with filename param', async () => {
		const res = await POST({
			url: new URL('http://test/api/documents?filename=raw.pdf'),
			request: new Request('http://test/api/documents?filename=raw.pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: 'pdf-bytes-here'
			})
		} as never);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string };
		const src = getDb().prepare('SELECT filename, file_type FROM sources WHERE id = ?').get(body.id) as {
			filename: string;
			file_type: string;
		};
		expect(src).toMatchObject({ filename: 'raw.pdf', file_type: 'pdf' });
	});

	it('rejects octet-stream uploads without a filename', async () => {
		const res = await POST({
			url: new URL('http://test/api/documents'),
			request: new Request('http://test/api/documents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: 'data'
			})
		} as never);
		expect(res.status).toBe(400);
	});

	it('sanitizes traversal filenames from the query param', async () => {
		const res = await POST({
			url: new URL('http://test/api/documents?filename=' + encodeURIComponent('../../evil.txt')),
			request: new Request('http://test/api/documents?filename=' + encodeURIComponent('../../evil.txt'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: 'evil content here'
			})
		} as never);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string };
		const src = getDb().prepare('SELECT filename, stored_name FROM sources WHERE id = ?').get(body.id) as {
			filename: string;
			stored_name: string;
		};
		expect(src.filename).toBe('evil.txt');
		expect(src.stored_name).not.toContain('..');
	});
});

describe('GET /api/documents', () => {
	it('lists newest first', async () => {
		await POST({ request: postFile('b.txt', 'b') } as never);
		await POST({ request: postFile('a.txt', 'a') } as never);
		const res = await GET({} as never);
		const rows = (await res.json()) as Array<{ filename: string }>;
		expect(rows.map((r) => r.filename).sort()).toEqual(['a.txt', 'b.txt']);
	});
});

describe('DELETE /api/documents/:id', () => {
	it('deletes source, jobs and exclusive pages', async () => {
		const created = (await (
			await POST({ request: postFile('gone.txt', 'bye bye content') } as never)
		).json()) as { id: string };
		await waitForJobsDone();
		expect(getDb().prepare('SELECT COUNT(*) AS n FROM wiki_pages').get()).toMatchObject({ n: 1 });
		const res = await deleteSource({ params: { id: created.id } } as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ deleted: created.id, pages: ['sources/gone.md'] });
		expect(getDb().prepare('SELECT COUNT(*) AS n FROM sources').get()).toMatchObject({ n: 0 });
		expect(getDb().prepare('SELECT COUNT(*) AS n FROM wiki_pages').get()).toMatchObject({ n: 0 });
	});

	it('404s unknown ids', async () => {
		const res = await deleteSource({ params: { id: 'missing' } } as never);
		expect(res.status).toBe(404);
	});

	it('handles multi-MB binary bodies without multipart parsing', async () => {
		const binary = Buffer.alloc(2 * 1024 * 1024, 0);
		const res = await POST({
			url: new URL('http://test/api/documents?filename=big.pdf'),
			request: new Request('http://test/api/documents?filename=big.pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: binary
			})
		} as never);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string };
		const src = getDb().prepare('SELECT file_size FROM sources WHERE id = ?').get(body.id) as { file_size: number };
		expect(src.file_size).toBe(2 * 1024 * 1024);
	});
});
