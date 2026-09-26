import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wikiApi } from '$lib/api/wiki';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe('wikiApi client', () => {
	it('returns parsed data on success', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ id: '1' }])));
		await expect(wikiApi.sources()).resolves.toEqual([{ id: '1' }]);
	});

	it('throws the server error message on failure', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));
		await expect(wikiApi.jobs()).rejects.toThrow('nope');
	});

	it('throws the server message on 401 failures', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'expired' }, 401)));
		await expect(wikiApi.pages()).rejects.toThrow('expired');
	});

	it('uploads files as octet-stream with filename param', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ id: '1', job_id: 'j' }));
		vi.stubGlobal('fetch', fetchMock);
		const file = new File(['x'], 'a.txt', { type: 'text/plain' });
		await expect(wikiApi.upload(file)).resolves.toEqual({ id: '1', job_id: 'j' });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/documents?filename=a.txt');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
		expect(init.body).toBe(file);
	});

	it('surfaces upload failures', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'too big' }, 413)));
		await expect(wikiApi.upload(new File(['x'], 'a.txt'))).rejects.toThrow('too big');
	});

	it('calls delete endpoints with DELETE', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ deleted: 'x' }));
		vi.stubGlobal('fetch', fetchMock);
		await wikiApi.deleteSource('s1');
		await wikiApi.deletePage('a/b.md');
		const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
		expect(calls.map(([url, init]) => [url, init.method])).toEqual([
			['/api/documents/s1', 'DELETE'],
			['/api/wiki/pages/a/b.md', 'DELETE']
		]);
	});

	it('fetches pages, search, chat, history, sessions and settings', async () => {
		const fetchMock = vi.fn(async (input: unknown) => jsonResponse({ url: String(input) }));
		vi.stubGlobal('fetch', fetchMock);
		await wikiApi.getPage('a.md');
		await wikiApi.search('q u');
		await wikiApi.chat('hi', 'sid');
		await wikiApi.history('sid');
		await wikiApi.sessions(['a', 'b']);
		await wikiApi.sessions([]);
		await wikiApi.settings();
		await wikiApi.saveSettings({ chat_model: 'm' });
		await wikiApi.runJobs();
		const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>;
		const urls = calls.map((c) => String(c[0]));
		expect(urls).toContain('/api/wiki/pages/a.md');
		expect(urls).toContain('/api/wiki/search?q=q%20u');
		expect(urls).toContain('/api/chat?sessionId=sid');
		expect(urls).toContain('/api/chat?ids=a,b');
		expect(urls).toContain('/api/chat');
		expect(urls).toContain('/api/settings');
		expect(urls).toContain('/api/jobs/run');
		const chatCall = calls.find((c) => String(c[0]) === '/api/chat');
		expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({ message: 'hi', sessionId: 'sid' });
	});
});
