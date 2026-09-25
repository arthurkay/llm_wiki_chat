import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPages } from '$lib/server/wiki/query.js';

export const GET: RequestHandler = async () => json(listPages());
