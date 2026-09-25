import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getAdminPassword,
	isAdminProtectionEnabled,
	makeAdminToken,
	isValidAdminToken,
	checkAdminPassword,
	ADMIN_COOKIE
} from '$lib/server/wiki/adminauth.js';

const SAVED = process.env.ADMIN_PASSWORD;

beforeEach(() => {
	delete process.env.ADMIN_PASSWORD;
});
afterEach(() => {
	if (SAVED === undefined) delete process.env.ADMIN_PASSWORD;
	else process.env.ADMIN_PASSWORD = SAVED;
});

describe('admin password source', () => {
	it('is disabled without the env var', () => {
		expect(getAdminPassword()).toBe('');
		expect(isAdminProtectionEnabled()).toBe(false);
	});

	it('enables with the env var', () => {
		process.env.ADMIN_PASSWORD = 's3cret';
		expect(isAdminProtectionEnabled()).toBe(true);
	});

	it('exposes the cookie name', () => {
		expect(ADMIN_COOKIE).toBe('wiki_admin');
	});
});

describe('password check', () => {
	it('accepts the exact password only', () => {
		process.env.ADMIN_PASSWORD = 's3cret';
		expect(checkAdminPassword('s3cret')).toBe(true);
		expect(checkAdminPassword('wrong')).toBe(false);
		expect(checkAdminPassword('')).toBe(false);
		expect(checkAdminPassword(42)).toBe(false);
	});

	it('rejects everything when unconfigured', () => {
		expect(checkAdminPassword('anything')).toBe(false);
	});
});

describe('admin token', () => {
	it('round-trips through the cookie', () => {
		process.env.ADMIN_PASSWORD = 's3cret';
		const token = makeAdminToken('s3cret');
		expect(isValidAdminToken(token)).toBe(true);
		expect(isValidAdminToken(token + 'x')).toBe(false);
		expect(isValidAdminToken(undefined)).toBe(false);
	});

	it('is bound to the password', () => {
		process.env.ADMIN_PASSWORD = 'one';
		const token = makeAdminToken('one');
		process.env.ADMIN_PASSWORD = 'two';
		expect(isValidAdminToken(token)).toBe(false);
	});

	it('is invalid without configuration', () => {
		expect(isValidAdminToken('whatever')).toBe(false);
	});
});
