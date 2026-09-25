import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as status, POST as login } from './login/+server.js';
import { GET as authed, POST as logout } from './session/+server.js';
import { makeAdminToken } from '$lib/server/wiki/adminauth.js';

const SAVED = process.env.ADMIN_PASSWORD;

function cookies(token?: string) {
	const store = new Map<string, string>();
	if (token !== undefined) store.set('wiki_admin', token);
	return {
		get: (k: string) => store.get(k),
		set: vi.fn((k: string, v: string) => store.set(k, v)),
		delete: vi.fn((k: string) => store.delete(k)),
		store
	};
}

function jsonRequest(body: unknown): Request {
	return new Request('http://test/api/admin/login', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
	process.env.ADMIN_PASSWORD = 's3cret';
});
afterEach(() => {
	if (SAVED === undefined) delete process.env.ADMIN_PASSWORD;
	else process.env.ADMIN_PASSWORD = SAVED;
});

describe('GET /api/admin/login (status)', () => {
	it('reports protection state', async () => {
		expect(await (await status({} as never)).json()).toEqual({ protected: true });
		delete process.env.ADMIN_PASSWORD;
		expect(await (await status({} as never)).json()).toEqual({ protected: false });
	});
});

describe('POST /api/admin/login', () => {
	it('sets a signed cookie on correct password', async () => {
		const jar = cookies();
		const res = await login({ request: jsonRequest({ password: 's3cret' }), cookies: jar } as never);
		expect(res.status).toBe(200);
		expect(jar.set).toHaveBeenCalledWith('wiki_admin', makeAdminToken('s3cret'), expect.objectContaining({ httpOnly: true, path: '/' }));
	});

	it('rejects wrong passwords', async () => {
		const res = await login({ request: jsonRequest({ password: 'nope' }), cookies: cookies() } as never);
		expect(res.status).toBe(401);
	});

	it('rejects malformed bodies', async () => {
		const res = await login({ request: new Request('http://test/x', { method: 'POST', body: 'not-json{{' }) } as never);
		expect(res.status).toBe(400);
	});

	it('passes through when unprotected', async () => {
		delete process.env.ADMIN_PASSWORD;
		const res = await login({ request: jsonRequest({}), cookies: cookies() } as never);
		expect(await res.json()).toEqual({ ok: true, unprotected: true });
	});
});

describe('/api/admin/session', () => {
	it('reports auth state from the cookie', async () => {
		const yes = await authed({ cookies: cookies(makeAdminToken('s3cret')) } as never);
		expect(await yes.json()).toEqual({ authed: true });
		const no = await authed({ cookies: cookies() } as never);
		expect(await no.json()).toEqual({ authed: false });
	});

	it('clears the cookie on logout', async () => {
		const jar = cookies(makeAdminToken('s3cret'));
		await logout({ cookies: jar } as never);
		expect(jar.delete).toHaveBeenCalledWith('wiki_admin', { path: '/' });
		expect(jar.store.has('wiki_admin')).toBe(false);
	});
});
