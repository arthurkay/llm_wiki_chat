import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getDb } from '$lib/server/wiki/db.js';
import { retrieveWikiContext, buildWikiContext, pageCitations } from '$lib/server/wiki/query.js';
import { createSession, sendMessage, isOpencodeReachable } from '$lib/server/wiki/opencode.js';
import { getSettings, parseModel, parseAgent } from '$lib/server/wiki/settings.js';

// Wiki-grounded chat: retrieve compiled wiki pages (FTS5 + wikilink expansion),
// inject as context under the admin-configured personality, persist in sqlite.
export const POST: RequestHandler = async ({ request }) => {
	const { message, sessionId } = (await request.json()) as { message?: string; sessionId?: string };
	if (!message || typeof message !== 'string') return json({ error: 'message required' }, { status: 400 });

	const db = getDb();
	let sid: string = sessionId ?? '';
	if (!sid) {
		sid = randomUUID();
		db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(sid, message.slice(0, 80));
	}
	const userId = randomUUID();
	db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(userId, sid, 'user', message);

	const pages = retrieveWikiContext(message, 5);
	const context = buildWikiContext(pages);
	const citations = pageCitations(pages);
	const settings = getSettings();

	if (!(await isOpencodeReachable())) {
		const fallback = `opencode server unreachable. Relevant wiki pages:\n\n${context.slice(0, 4000)}`;
		db.prepare('INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES (?, ?, ?, ?, ?)').run(
			randomUUID(), sid, 'assistant', fallback, JSON.stringify(citations)
		);
		return json({ sessionId: sid, reply: fallback, citations, opencode: false });
	}

	const row = db.prepare('SELECT opencode_session_id FROM chat_sessions WHERE id=?').get(sid) as {
		opencode_session_id: string | null;
	};
	let opencodeId = row?.opencode_session_id ?? null;
	if (!opencodeId) {
		const s = await createSession(message.slice(0, 80));
		opencodeId = s.id;
		db.prepare('UPDATE chat_sessions SET opencode_session_id=? WHERE id=?').run(opencodeId, sid);
	}
	const reply = await sendMessage(
		opencodeId,
		message,
		{ system: `${settings.system_prompt}\n\nWIKI CONTEXT:\n${context}`, model: parseModel(settings.chat_model), agent: parseAgent(settings.chat_agent) }
	);
	db.prepare('INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES (?, ?, ?, ?, ?)').run(
		randomUUID(), sid, 'assistant', reply, JSON.stringify(citations)
	);
	return json({ sessionId: sid, reply, citations, opencode: true });
};

export const GET: RequestHandler = async ({ url }) => {
	const sid = url.searchParams.get('sessionId');
	if (sid) {
		const exists = getDb().prepare('SELECT id FROM chat_sessions WHERE id = ?').get(sid);
		if (!exists) return json({ error: 'session not found' }, { status: 404 });
		const messages = getDb()
			.prepare('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at LIMIT 200')
			.all(sid);
		return json(messages);
	}
		// Only sessions this browser knows about (ids param); never leak other clients' chats
		const ids = (url.searchParams.get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => /^[a-zA-Z0-9-]{8,64}$/.test(s))
			.slice(0, 100);
		if (ids.length === 0) return json([]);
		const placeholders = ids.map(() => '?').join(',');
		const sessions = getDb()
			.prepare(
				`SELECT s.id, s.opencode_session_id, s.title, s.created_at,
				        COUNT(m.id) AS message_count, MAX(m.created_at) AS last_message_at
				 FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id
				 WHERE s.id IN (${placeholders})
				 GROUP BY s.id ORDER BY last_message_at DESC NULLS LAST, s.created_at DESC LIMIT 50`
			)
			.all(...ids);
		return json(sessions);
};
