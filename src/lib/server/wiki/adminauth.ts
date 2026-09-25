import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'wiki_admin';

/** Password comes from the environment so it never lands in git. */
export function getAdminPassword(): string {
	return process.env.ADMIN_PASSWORD ?? '';
}

export function isAdminProtectionEnabled(): boolean {
	return getAdminPassword().length > 0;
}

/** Signed token proving knowledge of the password (stateless, restart-safe). */
export function makeAdminToken(password: string): string {
	return createHmac('sha256', password).update('wiki-admin').digest('hex');
}

export function isValidAdminToken(token: string | undefined): boolean {
	const password = getAdminPassword();
	if (!password || !token) return false;
	const expected = Buffer.from(makeAdminToken(password));
	const actual = Buffer.from(token);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Constant-time password check against the env var. */
export function checkAdminPassword(candidate: unknown): boolean {
	const password = getAdminPassword();
	if (typeof candidate !== 'string' || !password) return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(password);
	return a.length === b.length && timingSafeEqual(a, b);
}
