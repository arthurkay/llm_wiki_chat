async function req<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const res = await fetch(path, {
		...init,
		signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
	return data as T;
}

export interface WikiSource {
	id: string;
	filename: string;
	file_type: string;
	file_size: number;
	status: string;
	created_at: string;
}

export interface IngestJobRow {
	id: string;
	source_id: string;
	status: string;
	error: string | null;
	created_at: string;
	filename: string;
}

export interface WikiPageMeta {
	path: string;
	title: string;
	kind: string;
	updated_at: string;
}

export interface ChatReply {
	sessionId: string;
	reply: string;
	citations: string[];
	opencode: boolean;
}

export interface StreamEvent {
	token?: string;
	full?: string;
	thinking?: string;
	thinkingFull?: string;
	done?: boolean;
	sessionId?: string;
	citations?: string[];
	opencode?: boolean;
	aborted?: boolean;
	error?: string;
}

/** POST /api/chat/stream and yield SSE events as they arrive. */
export async function chatStream(
	message: string,
	sessionId: string | undefined,
	signal: AbortSignal,
	onEvent: (e: StreamEvent) => void
): Promise<void> {
	const res = await fetch('/api/chat/stream', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message, sessionId }),
		signal
	});
	if (!res.ok || !res.body) throw new Error(`stream request failed (${res.status})`);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const frames = buf.split('\n\n');
		buf = frames.pop() ?? '';
		for (const frame of frames) {
			for (const line of frame.split('\n')) {
				if (!line.startsWith('data:')) continue;
				try {
					onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
				} catch {
					/* skip partial frame */
				}
			}
		}
	}
}

export interface ChatSession {
	id: string;
	opencode_session_id: string | null;
	title: string | null;
	created_at: string;
	message_count: number;
	last_message_at: string | null;
}

export interface ChatSettingsResponse {
	chat_model: string;
	system_prompt: string;
	chat_agent: string;
	models: Array<{ id: string; provider: string; model: string }>;
	opencode: boolean;
	default_system_prompt: string;
}

export const wikiApi = {
	sources: () => req<WikiSource[]>('/api/documents'),
	upload: async (file: File) => {
		// Raw octet-stream with ?filename= : immune to multipart parser limits.
		// Generous timeout: big files on slow mobile networks need time.
		const res = await fetch(`/api/documents?filename=${encodeURIComponent(file.name)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: file,
			signal: AbortSignal.timeout(180_000)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error((data as { error?: string }).error || 'Upload failed');
		return data as { id: string; job_id: string };
	},
	jobs: () => req<IngestJobRow[]>('/api/jobs'),
	runJobs: () => req<{ started: boolean }>('/api/jobs/run', { method: 'POST' }),
	retryJobs: (jobId?: string) =>
		req<{ retried: string[] }>('/api/jobs/retry', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(jobId ? { job_id: jobId } : {})
		}),
	pages: () => req<WikiPageMeta[]>('/api/wiki/pages'),
	search: (q: string) => req<Array<{ path: string; title: string; body: string }>>(`/api/wiki/search?q=${encodeURIComponent(q)}`),
	chat: (message: string, sessionId?: string, signal?: AbortSignal) =>
		req<ChatReply>('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, sessionId }),
			signal
		}, 300_000),
	history: (sessionId: string) =>
		req<Array<{ role: string; content: string; citations: string; thinking?: string }>>(`/api/chat?sessionId=${sessionId}`),
	sessions: (ids: string[]) =>
		req<ChatSession[]>(`/api/chat${ids.length ? `?ids=${ids.map(encodeURIComponent).join(',')}` : ''}`),
	deleteSource: (id: string) => req<{ deleted: string; pages: string[] }>(`/api/documents/${id}`, { method: 'DELETE' }),
	deletePage: (path: string) => req<{ deleted: string }>(`/api/wiki/pages/${encodeURI(path)}`, { method: 'DELETE' }),
	getPage: (path: string) =>
		req<{ path: string; title: string; kind: string; body: string; sources: string; updated_at: string }>(
			`/api/wiki/pages/${encodeURI(path)}`
		),
	settings: () => req<ChatSettingsResponse>('/api/settings'),
	saveSettings: (patch: { chat_model?: string; system_prompt?: string; chat_agent?: string }) =>
		req<ChatSettingsResponse>('/api/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		}),
	adminStatus: () => req<{ protected: boolean }>('/api/admin/login'),
	adminLogin: (password: string) =>
		req<{ ok: boolean }>('/api/admin/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password })
		}),
	adminAuthed: () => req<{ authed: boolean }>('/api/admin/session'),
	adminLogout: () => req<{ ok: boolean }>('/api/admin/session', { method: 'POST' }),
};
