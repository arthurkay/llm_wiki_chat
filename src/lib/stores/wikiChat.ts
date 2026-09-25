import { writable, get } from 'svelte/store';
import { wikiApi, chatStream, type ChatSession } from '$lib/api/wiki';

export interface WikiChatMessage {
	role: 'user' | 'assistant';
	content: string;
	citations?: string[];
	thinking?: string;
	thinkingOpen?: boolean;
}

const STORAGE_KEY = 'wiki.sessionId';
const KNOWN_KEY = 'wiki.sessions';

// Registry of session ids this browser started or opened — history only
// ever shows these, never other clients' sessions.
function knownIds(): string[] {
	try {
		const v = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as unknown;
		return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

function rememberId(id: string) {
	try {
		const ids = knownIds();
		if (!ids.includes(id)) localStorage.setItem(KNOWN_KEY, JSON.stringify([id, ...ids].slice(0, 50)));
	} catch {
		/* ignore */
	}
}

function forgetId(id: string) {
	try {
		localStorage.setItem(KNOWN_KEY, JSON.stringify(knownIds().filter((k) => k !== id)));
	} catch {
		/* ignore */
	}
}

function storedSessionId(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function persistSessionId(id: string | null) {
	try {
		if (id) localStorage.setItem(STORAGE_KEY, id);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

function parseCitations(raw: unknown): string[] | undefined {
	if (typeof raw !== 'string' || !raw) return undefined;
	try {
		const v = JSON.parse(raw) as unknown;
		return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : undefined;
	} catch {
		return undefined;
	}
}

function createWikiChat() {
	const store = writable<{
		sessionId: string | null;
		messages: WikiChatMessage[];
		sessions: ChatSession[];
		sending: boolean;
		error: string | null;
	}>({ sessionId: null, messages: [], sessions: [], sending: false, error: null });
	const { subscribe, set, update } = store;

	let controller: AbortController | null = null;

	function patchAssistant(content: string, citations?: string[]) {
		update((s) => {
			const messages = [...s.messages];
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === 'assistant') {
					messages[i] = { ...messages[i], content, citations: citations ?? messages[i].citations };
					break;
				}
			}
			return { ...s, messages };
		});
	}

	function lastAssistant(): WikiChatMessage | undefined {
		const messages = get(api).messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === 'assistant') return messages[i];
		}
		return undefined;
	}

	function dropEmptyAssistant() {
		update((s) => ({
			...s,
			messages: s.messages.filter((m) => !(m.role === 'assistant' && !m.content && !m.thinking))
		}));
	}

	function patchThinking(thinking: string) {
		update((s) => {
			const messages = [...s.messages];
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === 'assistant') {
					// Auto-collapse thoughts once the answer starts streaming
					const thinkingOpen = messages[i].content ? false : true;
					messages[i] = { ...messages[i], thinking, thinkingOpen };
					break;
				}
			}
			return { ...s, messages };
		});
	}

	const api = {
		subscribe,
		loadSessions: async () => {
			try {
				const sessions = await wikiApi.sessions(knownIds());
				update((s) => ({ ...s, sessions }));
			} catch {
				/* history unavailable; chat still works */
			}
		},
		/** Restore last session from storage so history survives reloads. */
		restore: async () => {
			const id = storedSessionId();
			if (id) {
				try {
					await api.open(id);
					return;
				} catch {
					persistSessionId(null);
				}
			}
			await api.loadSessions();
		},
		open: async (id: string) => {
			controller?.abort();
			let rows;
			try {
				rows = await wikiApi.history(id);
			} catch {
				// Session unknown server-side (deleted?): drop it from this browser's registry
				forgetId(id);
				if (storedSessionId() === id) persistSessionId(null);
				await api.loadSessions();
				throw new Error('chat not found');
			}
			update((s) => ({
				...s,
				sessionId: id,
				messages: rows.map((m) => ({
					role: m.role as 'user' | 'assistant',
					content: m.content,
					citations: parseCitations(m.citations),
					thinking: m.thinking || undefined,
					thinkingOpen: false
				})),
				sending: false,
				error: null
			}));
			persistSessionId(id);
			rememberId(id);
			await api.loadSessions();
		},
		send: async (content: string) => {
			controller?.abort();
			controller = new AbortController();
			const signal = controller.signal;
			let sid: string | null = null;
			update((s) => {
				sid = s.sessionId;
				return {
					...s,
					messages: [...s.messages, { role: 'user', content }, { role: 'assistant', content: '' }],
					sending: true,
					error: null
				};
			});
			try {
				await chatStream(content, sid ?? undefined, signal, (e) => {
					if (e.thinkingFull !== undefined) patchThinking(e.thinkingFull);
					if (e.full !== undefined) patchAssistant(e.full, e.citations);
					else if (e.token) patchAssistant(e.token);
					if (e.done) {
						if (e.sessionId) {
							persistSessionId(e.sessionId);
							rememberId(e.sessionId);
						}
						if (e.thinkingFull !== undefined) patchThinking(e.thinkingFull);
						if (e.citations) {
							const cur = lastAssistant();
							if (cur) patchAssistant(cur.content, e.citations);
						}
						update((s) => ({
							...s,
							sessionId: e.sessionId ?? s.sessionId,
							sending: false
						}));
						void api.loadSessions();
					}
					if (e.error) {
						dropEmptyAssistant();
						update((s) => ({ ...s, sending: false, error: e.error ?? 'chat failed' }));
					}
				});
				update((s) => (s.sending ? { ...s, sending: false } : s));
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					update((s) => ({ ...s, sending: false }));
					return;
				}
				update((s) => ({
					...s,
					sending: false,
					error: err instanceof Error ? err.message : 'chat failed'
				}));
				dropEmptyAssistant();
			} finally {
				controller = null;
			}
		},
		stop: () => controller?.abort(),
		toggleThinking: (index: number) => {
			update((s) => {
				const messages = [...s.messages];
				if (messages[index]) messages[index] = { ...messages[index], thinkingOpen: !messages[index].thinkingOpen };
				return { ...s, messages };
			});
		},
		newChat: () => {
			controller?.abort();
			persistSessionId(null);
			set({ sessionId: null, messages: [], sessions: [], sending: false, error: null });
			void api.loadSessions();
		}
	};
	return api;
}

export const wikiChat = createWikiChat();
