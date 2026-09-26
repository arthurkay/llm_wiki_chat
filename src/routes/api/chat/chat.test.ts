import { describe, it, expect, beforeEach } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { startOpencodeStub, type SeenRequest } from '../../../tests/stubserver.js';
import { getDb, upsertPageFts } from '$lib/server/wiki/db.js';
import { GET, POST } from './+server.js';
import { POST as streamPost } from './stream/+server.js';

useTempWiki();

const seen: SeenRequest[] = [];

function seedSession(withOpencode = true): string {
	const db = getDb();
	db.prepare("INSERT INTO chat_sessions (id, opencode_session_id, title) VALUES ('ses-local', 'ses-remote', 'Hello world')").run();
	if (!withOpencode) db.prepare('UPDATE chat_sessions SET opencode_session_id = NULL WHERE id = ?').run('ses-local');
	db.prepare("INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 'ses-local', 'user', 'Hello world')").run();
	db.prepare("INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES ('m2', 'ses-local', 'assistant', 'Hi there', '[\"sources/a.md\"]')").run();
	return 'ses-local';
}

function seedWiki() {
	getDb().prepare("INSERT INTO wiki_pages (path, title, kind, body, sources) VALUES ('sources/a.md','A','source','greetings and salutations',?)").run(
		JSON.stringify(['hello-doc.pdf'])
	);
	upsertPageFts('sources/a.md', 'A', 'greetings and salutations');
}

beforeEach(async () => {
	seen.length = 0;
	await startOpencodeStub({
		'GET /global/health': () => ({ json: { healthy: true } }),
		'POST /session': () => ({ json: { id: 'ses-new', title: 't' } }),
		'POST /session/ses-remote/message': () => ({ json: { info: {}, parts: [{ type: 'text', text: 'sync reply' }] } }),
		'POST /session/*/message': () => ({ json: { info: {}, parts: [{ type: 'text', text: 'sync reply' }] } }),
		'POST /session/ses-remote/prompt_async': () => ({ status: 204, json: {} }),
		'GET /event': () => ({ json: {} }) // unused; real streaming covered in opencode-stream tests
	}, seen);
});

describe('GET /api/chat', () => {
	it('returns [] without known ids', async () => {
		seedSession();
		const res = await GET({ url: new URL('http://test/api/chat') } as never);
		expect(await res.json()).toEqual([]);
	});

	it('returns only requested sessions with counts', async () => {
		seedSession();
		getDb().prepare("INSERT INTO chat_sessions (id, title) VALUES ('other', 'Other')").run();
		const res = await GET({ url: new URL('http://test/api/chat?ids=ses-local') } as never);
		const rows = (await res.json()) as Array<{ id: string; message_count: number; opencode_session_id: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: 'ses-local', message_count: 2, opencode_session_id: 'ses-remote' });
	});

	it('rejects malformed ids', async () => {
		seedSession();
		const res = await GET({ url: new URL('http://test/api/chat?ids=!!!,x') } as never);
		expect(await res.json()).toEqual([]);
	});

	it('returns messages for a known session', async () => {
		seedSession();
		const res = await GET({ url: new URL('http://test/api/chat?sessionId=ses-local') } as never);
		const rows = (await res.json()) as Array<{ role: string }>;
		expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
	});

	it('404s unknown sessions', async () => {
		const res = await GET({ url: new URL('http://test/api/chat?sessionId=missing-1') } as never);
		expect(res.status).toBe(404);
	});
});

describe('POST /api/chat', () => {
	it('rejects empty messages', async () => {
		const res = await POST({ request: new Request('http://test/api/chat', { method: 'POST', body: JSON.stringify({}) }) } as never);
		expect(res.status).toBe(400);
	});

	it('creates sessions, retrieves wiki context and persists the reply', async () => {
		seedWiki();
		const res = await POST({
			request: new Request('http://test/api/chat', { method: 'POST', body: JSON.stringify({ message: 'greetings friend' }) })
		} as never);
		const body = (await res.json()) as { sessionId: string; reply: string; citations: string[]; opencode: boolean };
		expect(body).toMatchObject({ reply: 'sync reply', citations: ['hello-doc.pdf'], opencode: true });
		const saved = getDb().prepare('SELECT role FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(body.sessionId) as Array<{
			role: string;
		}>;
		expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
		const opencodeId = (getDb().prepare('SELECT opencode_session_id AS id FROM chat_sessions WHERE id = ?').get(body.sessionId) as { id: string }).id;
		expect(opencodeId).toBe('ses-new');
	});

	it('sends chat answers via the read-only agent', async () => {
		seedWiki();
		const { updateSettings } = await import('$lib/server/wiki/settings.js');
		updateSettings({ chat_agent: 'wiki-readonly' });
		await POST({
			request: new Request('http://test/api/chat', { method: 'POST', body: JSON.stringify({ message: 'greetings friend' }) })
		} as never);
		const posted = seen.find((r) => r.url === '/session/ses-new/message');
		expect(JSON.parse(posted?.body ?? '{}').agent).toBe('wiki-readonly');
	});

	it('omits agent by default so free-tier backends keep working', async () => {
		seedWiki();
		await POST({
			request: new Request('http://test/api/chat', { method: 'POST', body: JSON.stringify({ message: 'greetings friend' }) })
		} as never);
		const posted = seen.find((r) => r.url === '/session/ses-new/message');
		expect(JSON.parse(posted?.body ?? '{}')).not.toHaveProperty('agent');
	});

	it('falls back to raw wiki context when opencode is down', async () => {
		const { setOpencodeBase, getOpencodeBase } = await import('$lib/server/wiki/opencode.js');
		const saved = getOpencodeBase();
		setOpencodeBase('http://127.0.0.1:1');
		try {
			seedWiki();
			const res = await POST({
				request: new Request('http://test/api/chat', { method: 'POST', body: JSON.stringify({ message: 'greetings' }) })
			} as never);
			const body = (await res.json()) as { reply: string };
			expect(body.reply).toMatch(/unreachable/);
		} finally {
			setOpencodeBase(saved);
		}
	});
});

describe('POST /api/chat/stream', () => {
	it('rejects empty messages', async () => {
		const res = await streamPost({ request: new Request('http://test/api/chat/stream', { method: 'POST', body: JSON.stringify({}) }) } as never);
		expect(res.status).toBe(400);
	});
});
