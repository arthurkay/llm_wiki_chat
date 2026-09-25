import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterAll } from 'vitest';
import { configureWikiPaths, closeDb } from '$lib/server/wiki/db.js';

const dirs: string[] = [];

/** Isolate each test in a fresh tmp wiki data dir (db + raw + wiki). */
export function useTempWiki() {
	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), 'wiki-test-'));
		dirs.push(dir);
		configureWikiPaths(dir);
	});
	afterAll(() => {
		closeDb();
		for (const dir of dirs.splice(0)) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	});
}
