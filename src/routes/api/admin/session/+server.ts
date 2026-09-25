import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminToken, ADMIN_COOKIE } from '$lib/server/wiki/adminauth.js';

export const GET: RequestHandler = async ({ cookies }) => {
	return json({ authed: isValidAdminToken(cookies.get(ADMIN_COOKIE)) });
};

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(ADMIN_COOKIE, { path: '/' });
	return json({ ok: true });
};
