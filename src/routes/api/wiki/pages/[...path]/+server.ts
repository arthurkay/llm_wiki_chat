import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/wiki/db.js';
import { removeWikiPage } from '$lib/server/wiki/ingest.js';

export const GET: RequestHandler = async ({ params }) => {
	const relPath = params.path.replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '');
	const row = getDb().prepare('SELECT path, title, kind, body, sources, updated_at FROM wiki_pages WHERE path = ?').get(relPath);
	if (!row) return json({ error: 'page not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const relPath = params.path; // rest param: may contain slashes
	const removed = removeWikiPage(relPath, 'deleted from admin');
	if (!removed) return json({ error: 'page not found' }, { status: 404 });
	return json({ deleted: relPath });
};
