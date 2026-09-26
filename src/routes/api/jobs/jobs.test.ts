import { describe, it, expect, beforeEach } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { startOpencodeStub } from '../../../tests/stubserver.js';
import { getDb } from '$lib/server/wiki/db.js';
import { GET as listJobs } from './+server.js';
import { POST as runJobs } from './run/+server.js';
import { POST as retryJobs } from './retry/+server.js';
import { GET as getSettings, PUT as saveSettings } from '../settings/+server.js';

useTempWiki();

beforeEach(async () => {
	await startOpencodeStub({
		'GET /global/health': () => ({ json: { healthy: true } }),
		'GET /provider': () => ({ json: { providers: [{ id: 'zeta', models: ['z1'] }] } })
	});
});

describe('GET /api/jobs', () => {
	it('returns newest jobs with filenames', async () => {
		const res = await listJobs({} as never);
		expect(await res.json()).toEqual([]);
	});
});

describe('POST /api/jobs/run', () => {
	it('triggers the worker without blocking', async () => {
		const res = await runJobs({} as never);
		expect(await res.json()).toEqual({ started: true });
	});
});

function seedFailedJob(id: string, sourceId: string, status = 'failed'): void {
	const db = getDb();
	db.prepare("INSERT INTO sources (id, filename, file_type, sha256, status) VALUES (?, 'f.txt', 'txt', 'x', ?)").run(sourceId, status === 'failed' ? 'failed' : 'queued');
	db.prepare("INSERT INTO ingest_jobs (id, source_id, status, error) VALUES (?, ?, ?, 'opencode: boom')").run(id, sourceId, status);
}

async function postRetry(body?: unknown): Promise<Response> {
	const init: RequestInit = { method: 'POST' };
	if (body !== undefined) {
		init.headers = { 'Content-Type': 'application/json' };
		init.body = JSON.stringify(body);
	}
	return retryJobs({ request: new Request('http://test/api/jobs/retry', init) } as never);
}

describe('POST /api/jobs/retry', () => {
	it('retries one failed job', async () => {
		seedFailedJob('j1', 's1');
		const res = await postRetry({ job_id: 'j1' });
		expect(await res.json()).toEqual({ retried: ['j1'] });
	});

	it('404s unknown jobs', async () => {
		const res = await postRetry({ job_id: 'missing' });
		expect(res.status).toBe(404);
	});

	it('refuses non-failed jobs', async () => {
		seedFailedJob('j2', 's2', 'done');
		const res = await postRetry({ job_id: 'j2' });
		expect(res.status).toBe(409);
	});

	it('retries all failed jobs with an empty body', async () => {
		seedFailedJob('j3', 's3');
		const res = await postRetry();
		expect(await res.json()).toEqual({ retried: ['j3'] });
	});
});

describe('/api/settings', () => {
	it('serves defaults plus discovered models', async () => {
		const res = await getSettings({} as never);
		const body = (await res.json()) as {
			chat_model: string;
			system_prompt: string;
			models: Array<{ id: string }>;
			opencode: boolean;
			default_system_prompt: string;
		};
		expect(body.chat_model).toBe('');
		expect(body.system_prompt).toBe(body.default_system_prompt);
		expect(body.models).toEqual([{ id: 'zeta/z1', provider: 'zeta', model: 'z1' }]);
		expect(body.opencode).toBe(true);
	});

	it('updates and truncates overlong values', async () => {
		const put = (patch: unknown) =>
			saveSettings({ request: new Request('http://test/api/settings', { method: 'PUT', body: JSON.stringify(patch) }) } as never);
		const res = await put({ chat_model: 'a/'.padEnd(500, 'x'), system_prompt: 'hi', junk: 1 });
		const body = (await res.json()) as { chat_model: string; system_prompt: string };
		expect(body.chat_model).toHaveLength(200);
		expect(body.system_prompt).toBe('hi');
	});
});
