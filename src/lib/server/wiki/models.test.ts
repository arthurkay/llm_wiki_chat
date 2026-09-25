import { describe, it, expect, beforeEach } from 'vitest';
import { startOpencodeStub } from '../../../tests/stubserver.js';
import { collectOptions, listModels, type ModelOption } from '$lib/server/wiki/models.js';
import { setOpencodeBase } from '$lib/server/wiki/opencode.js';

describe('collectOptions', () => {
	it('reads array-shaped models', () => {
		const out: ModelOption[] = [];
		collectOptions({ providers: [{ id: 'acme', models: ['a', 'b'] }] }, out);
		expect(out).toEqual([
			{ id: 'acme/a', provider: 'acme', model: 'a' },
			{ id: 'acme/b', provider: 'acme', model: 'b' }
		]);
	});

	it('reads object-map models with object entries', () => {
		const out: ModelOption[] = [];
		collectOptions(
			{ all: [{ id: 'deep', models: { 't/Hy3': { id: 't/Hy3' }, plain: { name: 'plain' } } }] },
			out
		);
		expect(out).toEqual([
			{ id: 'deep/t/Hy3', provider: 'deep', model: 't/Hy3' },
			{ id: 'deep/plain', provider: 'deep', model: 'plain' }
		]);
	});

	it('supports top-level arrays and skips junk', () => {
		const out: ModelOption[] = [];
		collectOptions([{ id: 'p', models: [{ modelID: 'm' }] }, null, { noid: true }, 'str'], out);
		expect(out).toEqual([{ id: 'p/m', provider: 'p', model: 'm' }]);
	});

	it('ignores non-objects', () => {
		const out: ModelOption[] = [];
		collectOptions(null, out);
		collectOptions('nope', out);
		expect(out).toEqual([]);
	});
});

describe('listModels', () => {
	beforeEach(async () => {
		await startOpencodeStub({
			'GET /provider': () => ({ json: { all: [{ id: 'zeta', models: { z1: { id: 'z1' } } }] } })
		});
	});

	it('returns normalized options from the first working route', async () => {
		await expect(listModels()).resolves.toEqual([{ id: 'zeta/z1', provider: 'zeta', model: 'z1' }]);
	});

	it('returns empty when the server is unreachable', async () => {
		setOpencodeBase('http://127.0.0.1:1');
		await expect(listModels()).resolves.toEqual([]);
	});
});
