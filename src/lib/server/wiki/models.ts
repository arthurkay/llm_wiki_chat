// Provider/model discovery via `opencode serve` REST API.
// Tries v1 then v2 routes; normalizes defensively since shapes vary by version.
const BASE = (process.env.OPENCODE_API_URL ?? 'http://127.0.0.1:4096').replace(/\/$/, '');

export interface ModelOption {
	id: string; // "provider/model"
	provider: string;
	model: string;
}

function collectOptions(payload: unknown, out: ModelOption[]): void {
	if (!payload || typeof payload !== 'object') return;
	const obj = payload as Record<string, unknown>;
	// Candidate provider lists live under several keys depending on version
	const pools: unknown[] = [];
	for (const key of ['providers', 'all', 'connected']) {
		if (Array.isArray(obj[key])) pools.push(...(obj[key] as unknown[]));
	}
	if (Array.isArray(payload)) pools.push(...payload);
	for (const p of pools) {
		if (!p || typeof p !== 'object') continue;
		const prov = p as Record<string, unknown>;
		const providerID = String(prov.id ?? prov.providerID ?? prov.name ?? '');
		// models may be an array or an object map {modelId: {...}}
		let models: unknown[] = [];
		if (Array.isArray(prov.models)) models = prov.models;
		else if (prov.models && typeof prov.models === 'object') models = Object.values(prov.models as Record<string, unknown>);
		for (const m of models) {
			let modelID = '';
			if (typeof m === 'string') modelID = m;
			else if (m && typeof m === 'object') {
				const mm = m as Record<string, unknown>;
				modelID = String(mm.id ?? mm.modelID ?? mm.name ?? '');
			}
			if (providerID && modelID) out.push({ id: `${providerID}/${modelID}`, provider: providerID, model: modelID });
		}
	}
}

export async function listModels(): Promise<ModelOption[]> {
	const paths = ['/provider', '/api/provider', '/config/providers', '/api/config/providers'];
	const seen = new Set<string>();
	const out: ModelOption[] = [];
	for (const path of paths) {
		try {
			const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) continue;
			const before = out.length;
			collectOptions(await res.json(), out);
			if (out.length > before) break; // first route that yields models wins
		} catch {
			// try next
		}
	}
	return out.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
}
