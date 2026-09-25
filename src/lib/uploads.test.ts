import { describe, it, expect } from 'vitest';
import {
	MAX_UPLOAD_BYTES,
	ALLOWED_UPLOAD_EXTENSIONS,
	UPLOAD_ACCEPT_ATTR,
	getUploadExtension,
	validateUploadFile,
	formatBytes
} from '$lib/uploads.js';

describe('upload policy constants', () => {
	it('caps at 20MB', () => {
		expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
	});

	it('allows only pdf, markdown and text', () => {
		expect([...ALLOWED_UPLOAD_EXTENSIONS].sort()).toEqual(['.markdown', '.md', '.pdf', '.text', '.txt']);
		expect(UPLOAD_ACCEPT_ATTR).toBe('.pdf,.md,.markdown,.txt,.text');
	});
});

describe('getUploadExtension', () => {
	it.each([
		['a.PDF', '.pdf'],
		['notes.markdown', '.markdown'],
		['noext', '.noext'],
		['.hidden', '.hidden']
	])('%s -> %s', (input, expected) => {
		expect(getUploadExtension(input)).toBe(expected);
	});
});

describe('validateUploadFile', () => {
	it.each(['a.pdf', 'a.md', 'a.markdown', 'a.txt', 'a.text', 'A.PDF'])('accepts %s', (name) => {
		expect(validateUploadFile(name, 100)).toEqual({ ok: true, ext: name.slice(name.lastIndexOf('.')).toLowerCase() });
	});

	it.each(['a.exe', 'a.zip', 'a.png', 'a.docx'])('rejects %s', (name) => {
		const r = validateUploadFile(name, 100);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/only PDF, Markdown and text/i);
	});

	it('accepts exactly 20MB and rejects a byte more', () => {
		expect(validateUploadFile('a.pdf', MAX_UPLOAD_BYTES).ok).toBe(true);
		const r = validateUploadFile('a.pdf', MAX_UPLOAD_BYTES + 1);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/20MB max/);
	});
});

describe('formatBytes', () => {
	it.each([
		[500, '500 B'],
		[2048, '2.0 KB'],
		[20 * 1024 * 1024, '20.0 MB']
	])('%d -> %s', (input, expected) => {
		expect(formatBytes(input)).toBe(expected);
	});
});
