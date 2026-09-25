import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeSource } from '$lib/server/wiki/ingest.js';

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const result = removeSource(params.id);
		return json({ deleted: params.id, pages: result.pages });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 404 });
	}
};
