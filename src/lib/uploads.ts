// Shared upload policy: single source of truth for file validation.
// Used by the server route (authoritative) and by upload UIs (fast feedback).

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt', '.text'] as const;

export const UPLOAD_ACCEPT_ATTR = '.pdf,.md,.markdown,.txt,.text';

export function getUploadExtension(filename: string): string {
	return '.' + (filename.split('.').pop() ?? '').toLowerCase();
}

export type UploadValidation = { ok: true; ext: string } | { ok: false; error: string };

export function validateUploadFile(filename: string, sizeBytes: number): UploadValidation {
	const ext = getUploadExtension(filename);
	if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
		return { ok: false, error: 'only PDF, Markdown and text files are supported (.pdf, .md, .markdown, .txt, .text)' };
	}
	if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
		return { ok: false, error: 'this file looks empty (0 bytes) — if it lives in cloud storage, download it to the device first, then retry' };
	}
	if (sizeBytes > MAX_UPLOAD_BYTES) {
		return { ok: false, error: `file too large (${formatBytes(sizeBytes)} > 20MB max)` };
	}
	return { ok: true, ext };
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
