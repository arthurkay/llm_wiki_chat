import { describe, it, expect, beforeEach } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { startOpencodeStub } from '../../../tests/stubserver.js';
import { GET as listJobs } from './+server.js';
import { POST as runJobs } from './run/+server.js';
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
