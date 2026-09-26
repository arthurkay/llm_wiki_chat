import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { getDb, upsertPageFts, RAW_DIR, WIKI_DIR } from './db.js';
import { createSession, sendMessage, isOpencodeReachable } from './opencode.js';

// Background ingest worker (llm_wiki pattern).
// Trigger model: SvelteKit API routes call processPendingJobs() fire-and-forget
// after enqueueing, plus POST /api/jobs/run for manual runs. No daemon needed.
// Each job: read raw source -> opencode 2-step distill (analyze -> generate pages)
// -> atomic markdown writes -> FTS5 index -> index.md + log.md updates.
// Falls back to deterministic pages when opencode is unreachable so the wiki
// keeps compounding instead of stalling.

export interface IngestJob {
	id: string;
	source_id: string;
	status: string;
	error: string | null;
}

export function slugify(name: string): string {
	return name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}

function sha256(buf: Buffer): string {
	return createHash('sha256').update(buf).digest('hex');
}

export function extractText(filename: string, buf: Buffer): string {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.pdf')) {
		try {
			const tmp = join(RAW_DIR, `.tmp-${randomUUID()}.pdf`);
			writeFileSync(tmp, buf);
			const out = execSync(`pdftotext -layout "${tmp}" - 2>/dev/null | head -c 60000`, { encoding: 'utf-8' });
			try {
				execSync(`rm -f "${tmp}"`);
			} catch {
				/* ignore */
			}
			if (out.trim().length > 50) return out.slice(0, 60000);
		} catch {
			/* fall through to fallback */
		}
		return `[PDF binary not text-extractable without pdftotext: ${filename}, ${buf.length} bytes. Ingest the filename and mark the page needs_review.]`;
	}
	// txt / md / fallback: best-effort utf-8
	return buf.toString('utf-8').slice(0, 60000);
}

export function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function atomicWrite(path: string, content: string): void {
	const tmp = `${path}.${randomUUID()}.tmp`;
	writeFileSync(tmp, content);
	try {
		execSync(`mv "${tmp}" "${path}"`);
	} catch {
		writeFileSync(path, content);
	}
}

function appendLog(entry: string): void {
	const logPath = join(WIKI_DIR, 'log.md');
	if (!existsSync(logPath)) writeFileSync(logPath, '# Wiki log\n\n');
	appendFileSync(logPath, entry);
}

export function deterministicPages(title: string, filename: string, text: string): Array<{ path: string; title: string; kind: string; body: string }> {
	const slug = slugify(filename);
	const excerpt = text.slice(0, 2000);
	return [
		{
			path: `sources/${slug}.md`,
			title,
			kind: 'source',
			body: `---\ntype: source\ntitle: "${title.replace(/"/g, "'")}"\nsources: ["${filename}"]\nneeds_review: true\n---\n\n# ${title}\n\n> Ingested without LLM (opencode unreachable). Queued for LLM refinement.\n\n## Excerpt\n\n${excerpt}\n`
		}
	];
}

async function llmPages(title: string, filename: string, text: string): Promise<Array<{ path: string; title: string; kind: string; body: string }>> {
	const session = await createSession(`ingest ${filename}`);
	const analysis = await sendMessage(
		session.id,
		`Analyze this source for a personal wiki. Return: 1) 5-10 key takeaways, 2) entities (people/orgs/tools) with one-line descriptions, 3) concepts (theories/methods), 4) contradictions or open questions.\n\nSOURCE TITLE: ${title}\nSOURCE FILE: ${filename}\n\n${text.slice(0, 30000)}`,
		{ system: 'You are a disciplined wiki maintainer. Be concise, factual, cite sections.', timeoutMs: 600_000 }
	);
	const generated = await sendMessage(
		session.id,
		`Now render the wiki update as JSON ONLY, no prose: {"pages":[{"path":"sources/<slug>.md"|"entities/<slug>.md"|"concepts/<slug>.md","title":"...","kind":"source"|"entity"|"concept","body":"full markdown with YAML frontmatter incl. sources: [\\"${filename}\\"] and [[wikilinks]]"}]}. Keep bodies under 1500 words each.`,
		{ system: 'Output valid JSON only.', timeoutMs: 600_000 }
	);
	try {
		const start = generated.indexOf('{');
		const parsed = JSON.parse(generated.slice(start)) as {
			pages: Array<{ path: string; title: string; kind: string; body: string }>;
		};
		if (Array.isArray(parsed.pages) && parsed.pages.length > 0) return parsed.pages.slice(0, 8);
	} catch {
		/* fall through */
	}
	return [
		{
			path: `sources/${slugify(filename)}.md`,
			title,
			kind: 'source',
			body: `---\ntype: source\ntitle: "${title.replace(/"/g, "'")}"\nsources: ["${filename}"]\n---\n\n# ${title}\n\n## Analysis\n\n${analysis.slice(0, 8000)}\n`
		}
	];
}

/** True when the source/job vanished mid-run (deleted or reset): results must be dropped. */
export function isRunAborted(db: Pick<DatabaseSync, 'prepare'>, sourceId: string, jobId: string): boolean {
	const stillThere = db.prepare('SELECT id FROM sources WHERE id = ?').get(sourceId) as { id: string } | undefined;
	const jobRow = db.prepare('SELECT status FROM ingest_jobs WHERE id = ?').get(jobId) as { status: string } | undefined;
	return !stillThere || !jobRow || jobRow.status !== 'processing';
}

export function refreshIndexAndOverview(): void {
	const db = getDb();
	const pages = db.prepare('SELECT path, title, kind FROM wiki_pages ORDER BY kind, title').all() as unknown as Array<{
		path: string;
		title: string;
		kind: string;
	}>;
	const lines = ['# Wiki index\n'];
	for (const p of pages) lines.push(`- [${p.title}](${p.path}) — ${p.kind}`);
	atomicWrite(join(WIKI_DIR, 'index.md'), lines.join('\n') + '\n');
}

/** Delete one wiki page (markdown file + sqlite rows + FTS). Returns true if it existed. */
export function removeWikiPage(relPath: string, reason: string): boolean {
	const safe = relPath.replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '');
	const db = getDb();
	const row = db.prepare('SELECT path FROM wiki_pages WHERE path = ?').get(safe) as { path: string } | undefined;
	if (!row) return false;
	try {
		rmSync(join(WIKI_DIR, safe), { force: true });
	} catch {
		/* ignore */
	}
	db.prepare('DELETE FROM wiki_pages WHERE path = ?').run(safe);
	db.prepare('DELETE FROM wiki_pages_fts WHERE path = ?').run(safe);
	refreshIndexAndOverview();
	appendLog(`\n## [${today()}] delete-page | ${safe} (${reason})\n`);
	return true;
}

/**
 * Delete an ingested source and everything derived exclusively from it:
 * raw file, ingest jobs, source row, and wiki pages whose provenance
 * traces solely to this file. Shared entity/concept pages survive.
 */
export function removeSource(sourceId: string): { pages: string[] } {
	const db = getDb();
	const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as {
		id: string;
		filename: string;
		stored_name: string;
	} | undefined;
	if (!src) throw new Error('source not found');

	const removed: string[] = [];
	const pages = db.prepare('SELECT path, sources FROM wiki_pages').all() as unknown as Array<{
		path: string;
		sources: string;
	}>;
	for (const p of pages) {
		let from: string[] = [];
		try {
			from = JSON.parse(p.sources) as string[];
		} catch {
			continue;
		}
		if (from.length > 0 && from.every((f) => f === src.filename)) {
			if (removeWikiPage(p.path, `source deleted: ${src.filename}`)) removed.push(p.path);
		}
	}

	const onDisk = src.stored_name || `${src.id}-${basename(src.filename)}`;
	try {
		rmSync(join(RAW_DIR, onDisk), { force: true });
	} catch {
		/* ignore */
	}
	db.prepare('DELETE FROM ingest_jobs WHERE source_id = ?').run(sourceId);
	db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
	appendLog(`\n## [${today()}] delete-source | ${src.filename} (+${removed.length} pages)\n`);
	return { pages: removed };
}

async function processJob(jobId: string): Promise<void> {
	const db = getDb();
	const job = db.prepare('SELECT * FROM ingest_jobs WHERE id = ?').get(jobId) as IngestJob & { source_id: string } | undefined;
	if (!job || job.status !== 'processing') return;
	try {
		const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(job.source_id) as {
			id: string;
			filename: string;
			stored_name: string;
			file_type: string;
		};
		// stored_name is the exact on-disk name; fall back to legacy pattern for old rows
		const onDisk = src.stored_name || `${src.id}-${basename(src.filename)}`;
		const rawPath = join(RAW_DIR, onDisk);
		const buf = readFileSync(rawPath);
		const text = extractText(src.filename, buf);
		const title = src.filename.replace(/\.[^.]+$/, '');

		const reachable = await isOpencodeReachable();
		const pages = reachable ? await llmPages(title, src.filename, text) : deterministicPages(title, src.filename, text);

		// Source deleted while the LLM was working: drop the result, no orphans
		if (isRunAborted(db, src.id, jobId)) {
			appendLog(`\n## [${today()}] ingest-skipped | ${src.filename} (source removed mid-run)\n`);
			return;
		}

		for (const p of pages) {
			const safePath = p.path.replace(/[^a-zA-Z0-9/_.-]/g, '').replace(/\.\./g, '');
			const full = join(WIKI_DIR, safePath);
			atomicWrite(full, p.body);
			db.prepare(
				`INSERT INTO wiki_pages (path, title, kind, body, sources, updated_at)
				 VALUES (?, ?, ?, ?, ?, datetime('now'))
				 ON CONFLICT(path) DO UPDATE SET title=excluded.title, kind=excluded.kind, body=excluded.body, sources=excluded.sources, updated_at=datetime('now')`
			).run(safePath, p.title.slice(0, 200), p.kind, p.body, JSON.stringify([src.filename]));
			upsertPageFts(safePath, p.title, p.body);
		}
		refreshIndexAndOverview();
		appendLog(`\n## [${today()}] ingest | ${src.filename} -> ${pages.map((p) => p.path).join(', ')}${reachable ? '' : ' (deterministic, opencode unreachable)'}\n`);
		db.prepare("UPDATE ingest_jobs SET status='done', updated_at=datetime('now') WHERE id=?").run(jobId);
		db.prepare("UPDATE sources SET status='completed' WHERE id=?").run(src.id);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		db.prepare('UPDATE ingest_jobs SET status=?, error=?, updated_at=datetime(\'now\') WHERE id=?').run('failed', msg.slice(0, 2000), jobId);
		const row = db.prepare('SELECT source_id FROM ingest_jobs WHERE id=?').get(jobId) as { source_id: string };
		db.prepare("UPDATE sources SET status='failed' WHERE id=?").run(row.source_id);
	}
}

let running = false;

/**
 * Requeue failed jobs (e.g. transient opencode failures) so the worker picks
 * them up again. Pass a job id for one job, or nothing for all failed jobs.
 * Returns the requeued job ids. Pure db operation — the caller triggers the worker.
 */
export function requeueFailedJobs(jobId?: string): string[] {
	const db = getDb();
	if (jobId) {
		const job = db.prepare('SELECT id, source_id, status FROM ingest_jobs WHERE id = ?').get(jobId) as {
			id: string;
			source_id: string;
			status: string;
		} | undefined;
		if (!job) throw new Error('job not found');
		if (job.status !== 'failed') throw new Error(`job is ${job.status}, only failed jobs can be retried`);
		db.prepare("UPDATE ingest_jobs SET status='queued', error=NULL, updated_at=datetime('now') WHERE id=?").run(jobId);
		db.prepare("UPDATE sources SET status='queued' WHERE id=?").run(job.source_id);
		return [jobId];
	}
	const failed = db.prepare("SELECT id, source_id FROM ingest_jobs WHERE status='failed'").all() as Array<{
		id: string;
		source_id: string;
	}>;
	for (const job of failed) {
		db.prepare("UPDATE ingest_jobs SET status='queued', error=NULL, updated_at=datetime('now') WHERE id=?").run(job.id);
		db.prepare("UPDATE sources SET status='queued' WHERE id=?").run(job.source_id);
	}
	return failed.map((j) => j.id);
}

export async function processPendingJobs(): Promise<void> {
	if (running) return;
	running = true;
	try {
		const db = getDb();
		// Recover jobs orphaned by a crashed/hung worker run
		db.prepare("UPDATE ingest_jobs SET status='queued' WHERE status='processing'").run();
		for (let i = 0; i < 5; i++) {
			const next = db
				.prepare("SELECT id FROM ingest_jobs WHERE status='queued' ORDER BY created_at LIMIT 1")
				.get() as { id: string } | undefined;
			if (!next) break;
			db.prepare("UPDATE ingest_jobs SET status='processing', updated_at=datetime('now') WHERE id=?").run(next.id);
			await processJob(next.id);
		}
	} finally {
		running = false;
	}
}

export { sha256 };
