import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { retrieveWikiContext } from '$lib/server/wiki/query.js';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const limit = Math.min(Number(url.searchParams.get('limit') ?? '5'), 20);
	return json(retrieveWikiContext(q, limit).map((p) => ({ path: p.path, title: p.title, body: p.body.slice(0, 2000) })));
};
