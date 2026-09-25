import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/wiki/db.js';

export const GET: RequestHandler = async () => {
	const rows = getDb()
		.prepare(
			`SELECT j.id, j.source_id, j.status, j.error, j.created_at, s.filename
			 FROM ingest_jobs j JOIN sources s ON s.id = j.source_id
			 ORDER BY j.created_at DESC LIMIT 100`
		)
		.all();
	return json(rows);
};
