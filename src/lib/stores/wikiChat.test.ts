import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { wikiChat } from '$lib/stores/wikiChat';

function sseResponse(frames: object[]): Response {
	const enc = new TextEncoder();
	const stream = new ReadableStream({
		start(c) {
			for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
			c.close();
		}
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
	vi.unstubAllGlobals();
	wikiChat.newChat();
});

describe('wikiChat store', () => {
	it('streams tokens into the assistant message and completes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				sseResponse([
					{ thinking: 'hmm', thinkingFull: 'hmm' },
					{ token: 'hel', full: 'hel' },
					{ token: 'lo', full: 'hello' },
					{ done: true, sessionId: 'sess-1', citations: ['a.md'] }
				])
			)
		);
		await wikiChat.send('hi');
		const s = get(wikiChat);
		expect(s.sending).toBe(false);
		expect(s.sessionId).toBe('sess-1');
		expect(s.messages).toHaveLength(2);
		expect(s.messages[1]).toMatchObject({ role: 'assistant', content: 'hello', thinking: 'hmm', citations: ['a.md'] });
	});

	it('drops the empty bubble and surfaces stream errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => sseResponse([{ error: 'kaput' }]))
		);
		await wikiChat.send('hi');
		const s = get(wikiChat);
		expect(s.error).toBe('kaput');
		expect(s.messages).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('stop() aborts an in-flight stream', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: unknown, init?: { signal?: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
					})
			)
		);
		const pending = wikiChat.send('slow question');
		await new Promise((r) => setTimeout(r, 20));
		wikiChat.stop();
		await pending;
		expect(get(wikiChat).sending).toBe(false);
	});

	it('opens history and toggles thoughts', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.startsWith('/api/chat?sessionId=')) {
					return Response.json([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', citations: '["x"]', thinking: 't' }]);
				}
				return Response.json([]);
			})
		);
		await wikiChat.open('s1');
		const s = get(wikiChat);
		expect(s.messages[1]).toMatchObject({ thinking: 't', thinkingOpen: false, citations: ['x'] });
		wikiChat.toggleThinking(1);
		expect(get(wikiChat).messages[1].thinkingOpen).toBe(true);
		wikiChat.toggleThinking(99); // out of range: no-op
	});
});

describe('wikiChat sessions', () => {
	it('restore falls back to the session list without stored state', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json([{ id: 's9', title: 'Nine', message_count: 0, opencode_session_id: null, created_at: '', last_message_at: '' }]))
		);
		await wikiChat.restore();
		expect(get(wikiChat).sessions.map((s) => s.id)).toEqual(['s9']);
	});

	it('newChat clears the conversation but keeps history', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
		await wikiChat.newChat();
		const s = get(wikiChat);
		expect(s.messages).toEqual([]);
		expect(s.sessionId).toBeNull();
		expect(s.sessions).toEqual([]);
	});

	it('open failure surfaces not-found without crashing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'x' }, { status: 404 })));
		await expect(wikiChat.open('gone')).rejects.toThrow();
	});
});
