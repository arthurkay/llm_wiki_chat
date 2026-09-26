import { describe, it, expect, beforeEach } from 'vitest';
import { startOpencodeStub, type SeenRequest } from '../../../tests/stubserver.js';
import {
	createSession,
	sendMessage,
	listMessages,
	abortSession,
	isOpencodeReachable,
	extractReplyText,
	setOpencodeBase,
	CHAT_AGENT
} from '$lib/server/wiki/opencode.js';

const seen: SeenRequest[] = [];

beforeEach(async () => {
	seen.length = 0;
	await startOpencodeStub(
		{
			'GET /global/health': () => ({ json: { healthy: true } }),
			'POST /session': () => ({ json: { id: 'ses_1', title: 't' } }),
			'POST /api/session': () => ({ json: { id: 'ses_api', title: 't' } }),
			'POST /session/ses_1/message': () => ({
				json: { info: {}, parts: [{ type: 'text', text: 'hello' }, { type: 'tool', text: 'x' }, { type: 'text', text: 'world' }] }
			}),
			'POST /api/session/ses_1/message': () => ({ json: { info: {}, parts: [{ type: 'text', text: 'api-fallback' }] } }),
			'POST /session/ses_html/message': () => ({ raw: '<!doctype html><html>nope</html>' }),
			'POST /api/session/ses_html/message': () => ({ json: { info: {}, parts: [{ type: 'text', text: 'recovered' }] } }),
			'GET /session/ses_1/message': () => ({ json: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hi' }] }] }),
			'POST /session/ses_1/abort': () => ({ json: true })
		},
		seen
	);
});

describe('extractReplyText', () => {
	it('concatenates text parts only', () => {
		expect(extractReplyText({ parts: [{ type: 'text', text: 'a' }, { type: 'x', text: 'b' }, { type: 'text', text: 'c' }] })).toBe('a\n\nc');
	});

	it('reads assistant messages from history shape', () => {
		const payload = [
			{ info: { role: 'user' }, parts: [{ type: 'text', text: 'q' }] },
			{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }
		];
		expect(extractReplyText(payload)).toBe('one\n\ntwo');
	});

	it('falls back to truncated JSON for unknown shapes', () => {
		const out = extractReplyText({ weird: true });
		expect(out).toContain('weird');
		expect(out.length).toBeLessThanOrEqual(4000);
	});
});

describe('sessions and messages', () => {
	it('creates a session and sends a message', async () => {
		const s = await createSession('t');
		expect(s).toEqual({ id: 'ses_1', title: 't' });
		const reply = await sendMessage('ses_1', 'hi');
		expect(reply).toBe('hello\n\nworld');
		const posted = seen.find((r) => r.url === '/session/ses_1/message');
		expect(JSON.parse(posted?.body ?? '{}').parts).toEqual([{ type: 'text', text: 'hi' }]);
	});

	it('recovers from a non-JSON 200 via the v2 route', async () => {
		await expect(sendMessage('ses_html', 'hi')).resolves.toBe('recovered');
	});

	it('defines the read-only chat agent', () => {
		expect(CHAT_AGENT).toBe('wiki-readonly');
	});

	it('forwards the agent when provided', async () => {
		await sendMessage('ses_1', 'hi', { agent: CHAT_AGENT });
		const posted = seen.find((r) => r.url === '/session/ses_1/message');
		expect(JSON.parse(posted?.body ?? '{}').agent).toBe('wiki-readonly');
	});

	it('omits agent when not provided', async () => {
		await sendMessage('ses_1', 'hi');
		const posted = seen.find((r) => r.url === '/session/ses_1/message');
		expect(JSON.parse(posted?.body ?? '{}')).not.toHaveProperty('agent');
	});

	it('lists messages', async () => {
		const msgs = (await listMessages('ses_1')) as Array<{ info: { role: string } }>;
		expect(msgs[0].info.role).toBe('assistant');
	});

	it('aborts without throwing', async () => {
		await expect(abortSession('ses_1')).resolves.toBeUndefined();
		expect(seen.some((r) => r.url === '/session/ses_1/abort')).toBe(true);
	});

	it('reports reachability', async () => {
		await expect(isOpencodeReachable()).resolves.toBe(true);
		setOpencodeBase('http://127.0.0.1:1');
		await expect(isOpencodeReachable()).resolves.toBe(false);
	});
});
