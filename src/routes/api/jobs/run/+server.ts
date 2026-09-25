import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processPendingJobs } from '$lib/server/wiki/ingest.js';

export const POST: RequestHandler = async () => {
	void processPendingJobs().catch(() => {});
	return json({ started: true });
};
