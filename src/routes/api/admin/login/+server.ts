import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isAdminProtectionEnabled,
	checkAdminPassword,
	makeAdminToken,
	getAdminPassword,
	ADMIN_COOKIE
} from '$lib/server/wiki/adminauth.js';

export const GET: RequestHandler = async () => {
	return json({ protected: isAdminProtectionEnabled() });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!isAdminProtectionEnabled()) return json({ ok: true, unprotected: true });
	let password: unknown;
	try {
		password = ((await request.json()) as { password?: unknown }).password;
	} catch {
		return json({ error: 'invalid request' }, { status: 400 });
	}
	if (!checkAdminPassword(password)) {
		return json({ error: 'wrong password' }, { status: 401 });
	}
	cookies.set(ADMIN_COOKIE, makeAdminToken(getAdminPassword()), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: 60 * 60 * 24 * 30
	});
	return json({ ok: true });
};
