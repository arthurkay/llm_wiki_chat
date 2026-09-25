// Minimal client for `opencode serve` REST API (v1 routes, v2 fallback).
// Docs: http(s)://<host>:<port>/doc (OpenAPI 3.1).
// Core flow: POST /session -> POST /session/:id/message -> GET /session/:id/message

let BASE = (process.env.OPENCODE_API_URL ?? 'http://127.0.0.1:4096').replace(/\/$/, '');

export function getOpencodeBase(): string {
	return BASE;
}

/** Test seam: point the client at a stub server. Not for production use. */
export function setOpencodeBase(url: string): void {
	BASE = url.replace(/\/$/, '');
}

export interface OpenCodeSession {
	id: string;
	title?: string;
}

interface TextPart {
	type: 'text';
	text: string;
}

function sessionRoutes(): string[][] {
	// [create, send, list] route prefixes to try in order
	return [
		['/session', '/session', '/session'],
		['/api/session', '/api/session', '/api/session']
	];
}

async function postJson(path: string, body: unknown, timeoutMs = 120_000): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
}

export async function isOpencodeReachable(): Promise<boolean> {
	for (const probe of ['/global/health', '/api/health']) {
		try {
			const res = await fetch(`${BASE}${probe}`, { signal: AbortSignal.timeout(5000) });
			if (res.ok) return true;
		} catch {
			// try next
		}
	}
	return false;
}

export async function createSession(title?: string): Promise<OpenCodeSession> {
	let lastErr = '';
	for (const [create] of sessionRoutes()) {
		try {
			const res = await postJson(create, title ? { title } : {});
			if (!res.ok) {
				lastErr = `${res.status} ${await res.text()}`;
				continue;
			}
			const data = (await res.json()) as { id: string; title?: string };
			return { id: data.id, title: data.title };
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}
	throw new Error(`opencode: create session failed (${lastErr}) — is \`opencode serve\` running at ${BASE}?`);
}

export function extractReplyText(payload: unknown): string {
	// POST .../message returns { info, parts } — concatenate text parts of assistant messages
	if (payload && typeof payload === 'object' && 'parts' in (payload as Record<string, unknown>)) {
		const parts = (payload as { parts: Array<{ type?: string; text?: string }> }).parts;
		if (Array.isArray(parts)) {
			const text = parts
				.filter((p) => p?.type === 'text' && typeof p.text === 'string')
				.map((p) => p.text as string)
				.join('\n\n')
				.trim();
			if (text) return text;
		}
	}
	if (Array.isArray(payload)) {
		const chunks: string[] = [];
		for (const m of payload as Array<{ info?: { role?: string }; parts?: TextPart[] }>) {
			if (m?.info?.role !== 'assistant' || !Array.isArray(m.parts)) continue;
			for (const p of m.parts) if (p?.type === 'text') chunks.push(p.text);
		}
		const text = chunks.join('\n\n').trim();
		if (text) return text;
	}
	return JSON.stringify(payload).slice(0, 4000);
}

export async function sendMessage(
	sessionId: string,
	text: string,
	opts: { system?: string; model?: string | { providerID: string; modelID: string }; agent?: string; timeoutMs?: number } = {}
): Promise<string> {
	const parts: TextPart[] = [{ type: 'text', text }];
	const body: Record<string, unknown> = { parts };
	if (opts.system) body.system = opts.system;
	if (opts.model) body.model = opts.model;
	if (opts.agent) body.agent = opts.agent;
	const timeoutMs = opts.timeoutMs ?? 300_000;

	let lastErr = '';
	for (const [, send] of sessionRoutes()) {
		try {
			const res = await postJson(`${send}/${sessionId}/message`, body, timeoutMs);
			const raw = await res.text();
			if (!res.ok) {
				lastErr = `${res.status} ${raw.slice(0, 300)}`;
				continue;
			}
			let payload: unknown;
			try {
				payload = JSON.parse(raw);
			} catch {
				lastErr = `non-JSON 200 response: ${raw.slice(0, 300)}`;
				continue;
			}
			return extractReplyText(payload);
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}
	throw new Error(`opencode: send message failed (${lastErr})`);
}

export async function listMessages(sessionId: string): Promise<unknown> {
	let lastErr = '';
	for (const [, , list] of sessionRoutes()) {
		try {
			const res = await fetch(`${BASE}${list}/${sessionId}/message`, { signal: AbortSignal.timeout(30_000) });
			if (!res.ok) {
				lastErr = `${res.status} ${await res.text()}`;
				continue;
			}
			return await res.json();
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}
	throw new Error(`opencode: list messages failed (${lastErr})`);
}

export async function abortSession(opencodeSessionId: string): Promise<void> {
	for (const [base] of sessionRoutes()) {
		try {
			const res = await fetch(`${BASE}${base}/${opencodeSessionId}/abort`, {
				method: 'POST',
				signal: AbortSignal.timeout(10_000)
			});
			if (res.ok) return;
		} catch {
			// try next route shape
		}
	}
}

async function postPromptAsync(
	opencodeSessionId: string,
	text: string,
	opts: { system?: string; model?: string | { providerID: string; modelID: string } } = {}
): Promise<void> {
	const parts = [{ type: 'text', text }];
	const body: Record<string, unknown> = { parts };
	if (opts.system) body.system = opts.system;
	if (opts.model) body.model = opts.model;
	let lastErr = '';
	for (const [, send] of sessionRoutes()) {
		try {
			const res = await postJson(`${send}/${opencodeSessionId}/prompt_async`, body, 30_000);
			if (res.status === 204 || res.ok) return;
			lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}
	throw new Error(`opencode: prompt_async failed (${lastErr})`);
}

export interface StreamCallbacks {
	onToken: (delta: string, fullText: string, kind: 'thinking' | 'text') => void;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * Stream an assistant reply via opencode's global SSE event bus:
 * prompt_async starts generation, message.part.delta events carry text
 * chunks, session.idle marks completion. Aborts any in-flight generation
 * on the session first so responses never pile up.
 *
 * Reasoning parts stream as kind 'thinking' before the final answer
 * streams as kind 'text' (Grok-style thoughts-then-answer).
 */
export async function sendMessageStream(
	opencodeSessionId: string,
	text: string,
	opts: { system?: string; model?: string | { providerID: string; modelID: string } } & StreamCallbacks
): Promise<{ text: string; thinking: string }> {
	const timeoutMs = opts.timeoutMs ?? 600_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error('stream timeout')), timeoutMs);
	const onExternalAbort = () => controller.abort();
	opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

	// Clear any stuck generation on this session before starting
	await abortSession(opencodeSessionId).catch(() => {});

	let fullText = '';
	let fullThinking = '';
	// partID -> 'thinking' | 'text', announced by part.updated before deltas
	const partKinds = new Map<string, 'thinking' | 'text'>();
	// Deltas that arrived before their part announcement
	const pending: Array<{ partID: string; delta: string }> = [];

	const emit = (delta: string, kind: 'thinking' | 'text') => {
		if (kind === 'thinking') {
			fullThinking += delta;
			opts.onToken(delta, fullThinking, 'thinking');
		} else {
			fullText += delta;
			opts.onToken(delta, fullText, 'text');
		}
	};

	try {
		const streamRes = await fetch(`${BASE}/event`, {
			headers: { Accept: 'text/event-stream' },
			signal: controller.signal
		});
		if (!streamRes.ok || !streamRes.body) throw new Error(`event bus ${streamRes.status}`);

		await postPromptAsync(opencodeSessionId, text, { system: opts.system, model: opts.model });

		const reader = streamRes.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let idle = false;
		while (!idle) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const frames = buf.split('\n\n');
			buf = frames.pop() ?? '';
			for (const frame of frames) {
				for (const line of frame.split('\n')) {
					if (!line.startsWith('data:')) continue;
					let evt: { type?: string; properties?: Record<string, unknown> };
					try {
						evt = JSON.parse(line.slice(5).trim()) as typeof evt;
					} catch {
						continue;
					}
					const props = evt.properties ?? {};
					if (props.sessionID !== opencodeSessionId) continue;
					if (evt.type === 'message.part.updated' && props.part && typeof props.part === 'object') {
						const part = props.part as { id?: string; type?: string };
						if (typeof part.id === 'string') {
							const kind = part.type === 'text' ? 'text' : part.type === 'reasoning' ? 'thinking' : null;
							if (kind) {
								partKinds.set(part.id, kind);
								// Flush buffered deltas for this part in arrival order
								for (let i = pending.length - 1; i >= 0; i--) {
									if (pending[i].partID === part.id) {
										emit(pending[i].delta, kind);
										pending.splice(i, 1);
									}
								}
							}
						}
					} else if (
						evt.type === 'message.part.delta' &&
						typeof props.delta === 'string' &&
						(props.field === 'text' || props.field === undefined)
					) {
						const kind = typeof props.partID === 'string' ? partKinds.get(props.partID) : undefined;
						if (kind) emit(props.delta as string, kind);
						else if (typeof props.partID === 'string') pending.push({ partID: props.partID, delta: props.delta as string });
					} else if (evt.type === 'session.idle') {
						idle = true;
						break;
					}
				}
				if (idle) break;
			}
		}
		await reader.cancel().catch(() => {});
		// Anything never classified defaults to answer text
		for (const p of pending) emit(p.delta, 'text');
		return { text: fullText, thinking: fullThinking };
	} catch (e) {
		if (opts.signal?.aborted) {
			await abortSession(opencodeSessionId).catch(() => {});
			throw new DOMException('aborted', 'AbortError');
		}
		throw e;
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onExternalAbort);
	}
}
