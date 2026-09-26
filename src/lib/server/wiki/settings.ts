import { getDb } from './db.js';

export const DEFAULT_SYSTEM_PROMPT = `You are the keeper of a personal wiki — a living knowledge base compiled from the user's own documents. You are warm, precise, and honest.

Rules:
- Answer from the wiki context first and cite the source document by name, e.g. [Board minutes 2024-01.pdf].
- If the wiki lacks the answer, say so plainly and suggest what source would fill the gap. Never invent citations.
- Be concise but complete. Format answers in clean Markdown (headings, lists, tables where they help).
- When new information contradicts an existing page, point it out explicitly.`;

export interface ChatSettings {
	chat_model: string;
	system_prompt: string;
	chat_agent: string;
}

export function getSettings(): ChatSettings {
	const db = getDb();
	const get = (key: string): string | null => {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
		return row?.value ?? null;
	};
	return {
		chat_model: get('chat_model') ?? '',
		system_prompt: get('system_prompt') ?? DEFAULT_SYSTEM_PROMPT,
		chat_agent: get('chat_agent') ?? ''
	};
}

export function updateSettings(patch: Partial<ChatSettings>): ChatSettings {
	const db = getDb();
	for (const [key, value] of Object.entries(patch)) {
		if (typeof value !== 'string') continue;
		db.prepare(
			`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
		).run(key, value);
	}
	return getSettings();
}

/** Split "provider/model" into opencode {providerID, modelID}. Empty string = server default. */
export function parseModel(ref: string): { providerID: string; modelID: string } | undefined {
	const i = ref.indexOf('/');
	if (i <= 0 || i === ref.length - 1) return undefined;
	return { providerID: ref.slice(0, i), modelID: ref.slice(i + 1) };
}

/**
 * Agent override for chat answers (e.g. a read-only agent defined in
 * opencode.json). Empty = server default. NOTE: restricted agents/agents
 * with tool overrides are rejected by some backends (opencode free tier
 * returns 403) — only set this where the backend permits it.
 */
export function parseAgent(ref: string): string | undefined {
	const name = ref.trim();
	return name ? name : undefined;
}
