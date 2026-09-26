import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getDb } from '$lib/server/wiki/db.js';
import { retrieveWikiContext, buildWikiContext, pageCitations } from '$lib/server/wiki/query.js';
import { createSession, sendMessageStream, isOpencodeReachable, abortSession } from '$lib/server/wiki/opencode.js';
import { getSettings, parseModel, parseAgent } from '$lib/server/wiki/settings.js';

// Streaming chat: same wiki grounding as /api/chat, but tokens stream to the
// browser as SSE so slow models never look hung. Final message persisted.
export const POST: RequestHandler = async ({ request }) => {
	const { message, sessionId } = (await request.json()) as { message?: string; sessionId?: string };
	if (!message || typeof message !== 'string') {
		return new Response(JSON.stringify({ error: 'message required' }), { status: 400 });
	}

	const db = getDb();
	let sid: string = sessionId ?? '';
	if (!sid) {
		sid = randomUUID();
		db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(sid, message.slice(0, 80));
	}
	db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
		randomUUID(), sid, 'user', message
	);

	const pages = retrieveWikiContext(message, 5);
	const context = buildWikiContext(pages);
	const citations = pageCitations(pages);
	const settings = getSettings();

	const stream = new ReadableStream({
		async start(controller) {
			const enc = new TextEncoder();
			const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
			const close = () => {
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};

			// Browser disconnected: stop opencode generation for this session
			request.signal.addEventListener('abort', () => {
				const row = db.prepare('SELECT opencode_session_id FROM chat_sessions WHERE id=?').get(sid) as {
					opencode_session_id: string | null;
				} | undefined;
				if (row?.opencode_session_id) void abortSession(row.opencode_session_id).catch(() => {});
			});

			if (!(await isOpencodeReachable())) {
				const fallback = `opencode server unreachable. Relevant wiki pages:\n\n${context.slice(0, 4000)}`;
				db.prepare('INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES (?, ?, ?, ?, ?)').run(
					randomUUID(), sid, 'assistant', fallback, JSON.stringify(citations)
				);
				send({ token: fallback, full: fallback, kind: 'text' });
				send({ done: true, sessionId: sid, citations, opencode: false });
				close();
				return;
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

			try {
				const { text: full, thinking } = await sendMessageStream(opencodeId, message, {
					system: `${settings.system_prompt}\n\nWIKI CONTEXT:\n${context}`,
					model: parseModel(settings.chat_model),
					agent: parseAgent(settings.chat_agent),
					signal: request.signal,
					onToken: (token, fullText, kind) => send(kind === 'thinking' ? { thinking: token, thinkingFull: fullText } : { token, full: fullText })
				});
				db.prepare('INSERT INTO chat_messages (id, session_id, role, content, citations, thinking) VALUES (?, ?, ?, ?, ?, ?)').run(
					randomUUID(), sid, 'assistant', full, JSON.stringify(citations), thinking
				);
				send({ done: true, sessionId: sid, citations, thinkingFull: thinking, opencode: true });
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') {
					send({ done: true, sessionId: sid, citations, aborted: true });
				} else {
					send({ error: e instanceof Error ? e.message : 'stream failed' });
				}
			} finally {
				close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
