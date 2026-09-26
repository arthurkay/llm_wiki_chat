import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requeueFailedJobs, processPendingJobs } from '$lib/server/wiki/ingest.js';

// Requeue failed ingest jobs (e.g. transient opencode failures) so the
// worker picks them up again. Optional { job_id } retries one job,
// otherwise all failed jobs are requeued.
export const POST: RequestHandler = async ({ request }) => {
	let jobId: unknown = undefined;
	try {
		jobId = ((await request.json()) as { job_id?: unknown }).job_id;
	} catch {
		// empty body: retry all failed
	}

	try {
		const retried = requeueFailedJobs(typeof jobId === 'string' && jobId ? jobId : undefined);
		void processPendingJobs().catch(() => {});
		return json({ retried });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'retry failed';
		const status = message === 'job not found' ? 404 : 409;
		return json({ error: message }, { status });
	}
};
