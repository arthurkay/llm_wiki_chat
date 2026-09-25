import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { afterAll } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { getDb, upsertPageFts } from '$lib/server/wiki/db.js';
import { setOpencodeBase, getOpencodeBase } from '$lib/server/wiki/opencode.js';
import { POST } from './stream/+server.js';

useTempWiki();

const servers: Server[] = [];
const savedBase = getOpencodeBase();

afterAll(() => {
	setOpencodeBase(savedBase);
	for (const s of servers) {
		try {
			s.close();
		} catch {
			/* ignore */
		}
	}
});

const SID = 'ses-e2e';
let failPrompt = false;

function sse(payload: object): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

async function startBus(script: Array<object>): Promise<void> {
	const server = createServer((req, res) => {
		const url = req.url?.split('?')[0];
		if (req.method === 'GET' && url === '/global/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"healthy":true}');
			return;
		}
		if (req.method === 'GET' && url === '/event') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream' });
			let i = 0;
			const timer = setInterval(() => {
				if (i >= script.length) {
					clearInterval(timer);
					return;
				}
				res.write(sse(script[i++]));
			}, 5);
			req.on('close', () => clearInterval(timer));
			return;
		}
		if (req.method === 'POST' && url === '/session') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: SID, title: 't' }));
			return;
		}
		if (req.method === 'POST' && url === `/session/${SID}/prompt_async`) {
			if (failPrompt) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end('{"error":"boom"}');
				return;
			}
			res.writeHead(204);
			res.end();
			return;
		}
		if (req.method === 'POST' && url === `/session/${SID}/abort`) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('true');
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end('{}');
	});
	servers.push(server);
	const url = await new Promise<string>((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
	it('creates local and opencode sessions when none is given', async () => {
		const res = await POST({
			request: new Request('http://test/api/chat/stream', {
				method: 'POST',
				body: JSON.stringify({ message: 'fresh chat here' })
			})
		} as never);
		const events = (await collect(res)) as Array<Record<string, unknown>>;
		const done = events.find((e) => e.done) as Record<string, unknown>;
		expect(done).toMatchObject({ opencode: true });
		expect(typeof done.sessionId).toBe('string');
		const row = getDb().prepare('SELECT opencode_session_id AS id FROM chat_sessions WHERE id = ?').get(done.sessionId as string) as { id: string };
		expect(row.id).toBe(SID);
	});

	it('forwards generation errors as error frames', async () => {
		failPrompt = true;
		try {
			const res = await POST({
				request: new Request('http://test/api/chat/stream', {
					method: 'POST',
					body: JSON.stringify({ message: 'will fail', sessionId: 'local-1' })
				})
			} as never);
			const events = (await collect(res)) as Array<Record<string, unknown>>;
			const err = events.find((e) => e.error) as Record<string, unknown>;
			expect(String(err.error)).toMatch(/prompt_async|boom/);
		} finally {
			failPrompt = false;
		}
	});
});
	});
	setOpencodeBase(url);
}

const script = [
	{ id: 'e1', type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'pr', type: 'reasoning' } } },
	{ id: 'e2', type: 'message.part.delta', properties: { sessionID: SID, partID: 'pr', field: 'text', delta: 'thinking hard' } },
	{ id: 'e3', type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'pt', type: 'text' } } },
	{ id: 'e4', type: 'message.part.delta', properties: { sessionID: SID, partID: 'pt', field: 'text', delta: 'final answer' } },
	{ id: 'e5', type: 'session.idle', properties: { sessionID: SID } }
];

beforeEach(async () => {
	await startBus(script);
	getDb().prepare("INSERT INTO chat_sessions (id, opencode_session_id, title) VALUES ('local-1', ?, 't')").run(SID);
});

async function collect(res: Response): Promise<object[]> {
	const events: object[] = [];
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const frames = buf.split('\n\n');
		buf = frames.pop() ?? '';
		for (const frame of frames) {
			for (const line of frame.split('\n')) {
				if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5).trim()) as object);
			}
		}
	}
	return events;
}

describe('POST /api/chat/stream', () => {
	it('streams thinking then answer and persists both', async () => {
		const res = await POST({
			request: new Request('http://test/api/chat/stream', {
				method: 'POST',
				body: JSON.stringify({ message: 'deep question', sessionId: 'local-1' })
			})
		} as never);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const events = (await collect(res)) as Array<Record<string, unknown>>;
		const thinking = events.filter((e) => 'thinking' in e);
		const tokens = events.filter((e) => 'token' in e);
		const done = events.find((e) => e.done) as Record<string, unknown>;
		expect(thinking.map((e) => e.thinking)).toEqual(['thinking hard']);
		expect(tokens.map((e) => e.token)).toEqual(['final answer']);
		expect(done).toMatchObject({ sessionId: 'local-1', citations: [], opencode: true });

		const saved = getDb().prepare("SELECT role, content, thinking FROM chat_messages WHERE session_id = 'local-1' ORDER BY created_at").all() as Array<{
			role: string;
			content: string;
			thinking: string;
		}>;
		expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(saved[1]).toMatchObject({ content: 'final answer', thinking: 'thinking hard' });
	});

	it('serves the offline fallback with citations', async () => {
		setOpencodeBase('http://127.0.0.1:1');
		getDb().prepare("INSERT INTO wiki_pages (path, title, kind, body) VALUES ('s/x.md','X','source','fallback words here')").run();
		upsertPageFts('s/x.md', 'X', 'fallback words here');
		const res = await POST({
			request: new Request('http://test/api/chat/stream', {
				method: 'POST',
				body: JSON.stringify({ message: 'fallback words', sessionId: 'local-1' })
			})
		} as never);
		const events = (await collect(res)) as Array<Record<string, unknown>>;
		const done = events.find((e) => e.done) as Record<string, unknown>;
		expect(done).toMatchObject({ opencode: false, citations: ['s/x.md'] });
	});
});
