import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings, updateSettings, DEFAULT_SYSTEM_PROMPT } from '$lib/server/wiki/settings.js';
import { listModels } from '$lib/server/wiki/models.js';
import { isOpencodeReachable } from '$lib/server/wiki/opencode.js';

export const GET: RequestHandler = async () => {
	const [settings, reachable] = await Promise.all([getSettings(), isOpencodeReachable()]);
	const models = reachable ? await listModels() : [];
	return json({ ...settings, models, opencode: reachable, default_system_prompt: DEFAULT_SYSTEM_PROMPT });
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { chat_model?: string; system_prompt?: string; chat_agent?: string };
	const patch: Record<string, string> = {};
	if (typeof body.chat_model === 'string') patch.chat_model = body.chat_model.slice(0, 200);
	if (typeof body.system_prompt === 'string') patch.system_prompt = body.system_prompt.slice(0, 8000);
	if (typeof body.chat_agent === 'string') patch.chat_agent = body.chat_agent.slice(0, 100);
	return json(updateSettings(patch));
};
