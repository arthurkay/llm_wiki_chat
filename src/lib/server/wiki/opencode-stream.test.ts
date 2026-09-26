import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { afterAll } from 'vitest';
import { sendMessageStream, setOpencodeBase, getOpencodeBase } from '$lib/server/wiki/opencode.js';

const servers: Server[] = [];
const savedBase = getOpencodeBase();
const aborted: string[] = [];

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

function sse(payload: object): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Stub whose /event replays a scripted generation, then idles. */
async function startStreamingStub(script: Array<object>, delayMs = 5): Promise<void> {
	const server = createServer((req, res) => {
		const url = req.url?.split('?')[0];
		if (req.method === 'GET' && url === '/event') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
			let i = 0;
			const timer = setInterval(() => {
				if (i >= script.length) {
					clearInterval(timer);
					return; // keep the connection open; client ends on session.idle
				}
				res.write(sse(script[i++]));
			}, delayMs);
			req.on('close', () => clearInterval(timer));
			return;
		}
		if (req.method === 'POST' && url === '/session/ses_stream/prompt_async') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				postedPromptBodies.push(body);
				res.writeHead(204);
				res.end();
			});
			return;
		}
		if (req.method === 'POST' && url === '/session/ses_stream/abort') {
			aborted.push(url);
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
		});
	});
	setOpencodeBase(url);
}

const SID = 'ses_stream';
const postedPromptBodies: string[] = [];
const script = [	{ id: 'e1', type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'p-reason', type: 'reasoning' } } },
	{ id: 'e2', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-reason', field: 'text', delta: 'hmm ' } },
	{ id: 'e3', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-reason', field: 'text', delta: 'thinking' } },
	{ id: 'e4', type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'p-text', type: 'text' } } },
	{ id: 'e5', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-text', field: 'text', delta: 'final ' } },
	{ id: 'e6', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-text', field: 'text', delta: 'answer' } },
	// Another session's noise must be ignored
	{ id: 'e7', type: 'message.part.delta', properties: { sessionID: 'ses_other', partID: 'p-text', field: 'text', delta: 'NOISE' } },
	{ id: 'e8', type: 'session.idle', properties: { sessionID: SID } }
];

beforeEach(async () => {
	aborted.length = 0;
	postedPromptBodies.length = 0;
	await startStreamingStub(script);
});

describe('sendMessageStream', () => {
	it('splits thinking and answer tokens in order', async () => {
		const events: Array<{ delta: string; kind: string }> = [];
		const result = await sendMessageStream(SID, 'question?', {
			system: 'sys',
			onToken: (delta, _full, kind) => events.push({ delta, kind })
		});
		expect(result).toEqual({ text: 'final answer', thinking: 'hmm thinking' });
		expect(events.map((e) => `${e.kind}:${e.delta}`)).toEqual([
			'thinking:hmm ',
			'thinking:thinking',
			'text:final ',
			'text:answer'
		]);
		// abort-first call happened before generation
		expect(aborted).toContain('/session/ses_stream/abort');
	});

	it('buffers deltas that arrive before their part announcement', async () => {
		await startStreamingStub([
			{ id: 'e1', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-late', field: 'text', delta: 'early' } },
			{ id: 'e2', type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'p-late', type: 'reasoning' } } },
			{ id: 'e3', type: 'session.idle', properties: { sessionID: SID } }
		]);
		const result = await sendMessageStream(SID, 'q?', { onToken: () => {} });
		expect(result).toEqual({ text: '', thinking: 'early' });
	});

	it('aborts cleanly on user cancel', async () => {
		await startStreamingStub(
			[
				{ id: 'e1', type: 'message.part.delta', properties: { sessionID: SID, partID: 'p-x', field: 'text', delta: 'never' } }
				// no idle: stream would hang without abort
			],
			50
		);
		const controller = new AbortController();
		const pending = sendMessageStream(SID, 'q?', { onToken: () => {}, signal: controller.signal, timeoutMs: 5000 });
		setTimeout(() => controller.abort(), 100);
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('forwards the agent to prompt_async when provided', async () => {
		const { CHAT_AGENT } = await import('$lib/server/wiki/opencode.js');
		await sendMessageStream(SID, 'question?', {
			system: 'sys',
			agent: CHAT_AGENT,
			onToken: () => {}
		});
		expect(postedPromptBodies.length).toBeGreaterThan(0);
		for (const raw of postedPromptBodies) {
			expect(JSON.parse(raw).agent).toBe('wiki-readonly');
		}
	});
});

describe('sendMessageStream failures', () => {
	it('reports prompt_async rejections', async () => {
		await startStreamingStub([]);
		// Override: prompt_async fails. startStreamingStub has no such route,
		// so patch via a raw server here instead:
		const { createServer } = await import('node:http');
		const { sendMessageStream: sms, setOpencodeBase: setBase } = await import('$lib/server/wiki/opencode.js');
		const srv = createServer((req, res) => {
			const url = req.url?.split('?')[0];
			if (req.method === 'GET' && url === '/event') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.end();
				return;
			}
			if (req.method === 'POST' && url?.endsWith('/prompt_async')) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end('{"error":"overloaded"}');
				return;
			}
			if (req.method === 'POST' && url?.endsWith('/abort')) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('true');
				return;
			}
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end('{}');
		});
		const port = await new Promise<number>((resolve) => {
			srv.listen(0, '127.0.0.1', () => {
				const addr = srv.address();
				resolve(typeof addr === 'object' && addr ? addr.port : 0);
			});
		});
		setBase(`http://127.0.0.1:${port}`);
		try {
			await expect(sms('ses_x', 'q?', { onToken: () => {} })).rejects.toThrow(/prompt_async failed/);
		} finally {
			srv.close();
		}
	});

	it('times out a silent event bus', async () => {
		await startStreamingStub([], 10);
		const { sendMessageStream: sms2 } = await import('$lib/server/wiki/opencode.js');
		// No prompt_async route and no idle will arrive; force a short timeout.
		// Point at a bus that accepts the connection but never idles:
		await expect(
			sms2('ses_stream', 'q?', { onToken: () => {}, timeoutMs: 300 })
		).rejects.toThrow();
	}, 10000);
});
