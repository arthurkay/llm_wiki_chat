import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handle } from './hooks.server.js';
import { makeAdminToken } from '$lib/server/wiki/adminauth.js';

const SAVED = process.env.ADMIN_PASSWORD;

function event(method: string, path: string, cookie?: string) {
	return {
		url: new URL('http://test' + path),
		request: new Request('http://test' + path, { method }),
		cookies: { get: (name: string) => (name === 'wiki_admin' ? cookie : undefined) },
		locals: {}
	} as never;
}

beforeEach(() => {
	process.env.ADMIN_PASSWORD = 's3cret';
});
afterEach(() => {
	if (SAVED === undefined) delete process.env.ADMIN_PASSWORD;
	else process.env.ADMIN_PASSWORD = SAVED;
});

describe('admin gating hook', () => {
	it('passes everything through when unprotected', async () => {
		delete process.env.ADMIN_PASSWORD;
		const resolve = vi.fn(async () => new Response('ok'));
		const res = (await handle({ event: event('DELETE', '/api/documents/x'), resolve } as never)) as Response;
		expect(await res.text()).toBe('ok');
		expect(resolve).toHaveBeenCalled();
	});

	it('blocks mutating APIs without a cookie', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		for (const [method, path] of [
			['GET', '/api/documents'],
			['DELETE', '/api/documents/x'],
			['GET', '/api/jobs'],
			['POST', '/api/jobs/run'],
			['GET', '/api/settings'],
			['PUT', '/api/settings'],
			['DELETE', '/api/wiki/pages/a.md']
		] as Array<[string, string]>) {
			const res = (await handle({ event: event(method, path), resolve } as never)) as Response;
			expect(res.status).toBe(401);
			expect(await res.json()).toMatchObject({ error: expect.stringMatching(/admin authentication/i) });
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it('leaves chat and wiki reads public', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		for (const [method, path] of [
			['POST', '/api/chat'],
			['POST', '/api/chat/stream'],
			['GET', '/api/chat'],
			['POST', '/api/documents'],
			['GET', '/api/wiki/search'],
			['GET', '/api/wiki/pages'],
			['GET', '/api/wiki/pages/a.md'],
			['GET', '/api/admin/login'],
			['GET', '/chat']
		] as Array<[string, string]>) {
			const res = (await handle({ event: event(method, path), resolve } as never)) as Response;
			expect(res.status).toBe(200);
		}
	});

	it('admits gated routes with a valid cookie and marks locals', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const token = makeAdminToken('s3cret');
		const ev = event('DELETE', '/api/documents/x', token);
		const res = (await handle({ event: ev, resolve } as never)) as Response;
		expect(await res.text()).toBe('ok');
		expect((ev as { locals: { isAdmin: boolean } }).locals.isAdmin).toBe(true);
	});

	it('rejects forged cookies', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const res = (await handle({ event: event('GET', '/api/settings', 'forged'), resolve } as never)) as Response;
		expect(res.status).toBe(401);
	});
});
