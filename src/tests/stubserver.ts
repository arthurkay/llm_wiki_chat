import { createServer, type Server, type IncomingMessage } from 'node:http';
import { afterAll } from 'vitest';
import { setOpencodeBase, getOpencodeBase } from '$lib/server/wiki/opencode.js';

export interface StubResponse {
	status?: number;
	json?: unknown;
	raw?: string;
}

export interface SeenRequest {
	method?: string;
	url?: string;
	body: string;
	headers: Record<string, string | string[] | undefined>;
}

const servers: Server[] = [];
const savedBase = getOpencodeBase();

/**
 * Start a stub opencode server. Routes map "METHOD path" -> responder.
 * Use "*" method or "*" path segments as wildcards, e.g. "POST /session/*\/message".
 */
export async function startOpencodeStub(
	routes: Record<string, (req: SeenRequest) => StubResponse>,
	seen: SeenRequest[] = []
): Promise<string> {
	const server = createServer((req: IncomingMessage, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const record: SeenRequest = {
				method: req.method,
				url: req.url,
				body,
				headers: req.headers as Record<string, string | string[] | undefined>
			};
			seen.push(record);
			const key = `${req.method} ${req.url?.split('?')[0]}`;
			const responder =
				routes[key] ??
				Object.entries(routes).find(([pattern]) => matchPattern(pattern, key))?.[1];
			if (!responder) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'stub: no route ' + key }));
				return;
			}
			const out = responder(record);
			if (out.raw !== undefined) {
				res.writeHead(out.status ?? 200, { 'Content-Type': 'text/html' });
				res.end(out.raw);
			} else {
				res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(out.json ?? {}));
			}
		});
	});
	servers.push(server);
	return new Promise<string>((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			const url = `http://127.0.0.1:${port}`;
			setOpencodeBase(url);
			resolve(url);
		});
	});
}

function matchPattern(pattern: string, key: string): boolean {
	const rx = new RegExp('^' + pattern.split('*').map(escapeRx).join('.*') + '$');
	return rx.test(key);
}

function escapeRx(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

afterAll(() => {
	setOpencodeBase(savedBase);
	for (const s of servers.splice(0)) {
		try {
			s.close();
		} catch {
			/* ignore */
		}
	}
});
