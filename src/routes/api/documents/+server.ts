import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getDb, RAW_DIR } from '$lib/server/wiki/db.js';
import { sha256, processPendingJobs } from '$lib/server/wiki/ingest.js';
import { validateUploadFile } from '$lib/uploads.js';

export const GET: RequestHandler = async () => {
	const rows = getDb().prepare('SELECT * FROM sources ORDER BY created_at DESC LIMIT 200').all();
	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: 'upload arrived empty or interrupted — please retry (on mobile, download cloud files to the device first)' }, { status: 400 });
	}
	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'file field required' }, { status: 400 });

	const validation = validateUploadFile(file.name, file.size);
	if (!validation.ok) return json({ error: validation.error }, { status: 400 });
	const ext = validation.ext;

	const buf = Buffer.from(await file.arrayBuffer());
	const id = randomUUID();
	const safeName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
	const storedName = `${id}-${safeName}`;
	writeFileSync(join(RAW_DIR, storedName), buf);

	const db = getDb();
	db.prepare(
		'INSERT INTO sources (id, filename, stored_name, file_type, file_size, sha256, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(id, file.name, storedName, ext.slice(1), file.size, sha256(buf), 'queued');
	const jobId = randomUUID();
	db.prepare('INSERT INTO ingest_jobs (id, source_id, status) VALUES (?, ?, ?)').run(jobId, id, 'queued');

	// Fire-and-forget: worker claims queued jobs without blocking the response
	void processPendingJobs().catch(() => {});

	return json({ id, job_id: jobId, status: 'queued' }, { status: 201 });
};
