import type { Handle } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { isAdminProtectionEnabled, isValidAdminToken, ADMIN_COOKIE } from '$lib/server/wiki/adminauth.js';

// Multi-user model: chat + wiki reading are public; everything that mutates
// the knowledge base or reveals admin state requires the admin cookie.
// The /admin page itself always renders — it shows a lock screen when gated.
const PUBLIC_API: Array<{ methods: string[]; pattern: RegExp }> = [
	{ methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], pattern: /^\/api\/admin\// },
	{ methods: ['GET', 'POST'], pattern: /^\/api\/chat(\/|$)/ },
	{ methods: ['GET'], pattern: /^\/api\/wiki\/search$/ },
	{ methods: ['GET'], pattern: /^\/api\/wiki\/pages(\/|$)/ },
	// Uploads stay public so any chat user can contribute sources;
	// listing and deleting them is admin-only.
	{ methods: ['POST'], pattern: /^\/api\/documents$/ }
];

export const handle: Handle = async ({ event, resolve }) => {
	const authed = isValidAdminToken(event.cookies.get(ADMIN_COOKIE));
	event.locals.isAdmin = authed;

	if (event.url.pathname.startsWith('/api/') && isAdminProtectionEnabled() && !authed) {
		const allowed = PUBLIC_API.some(
			(r) => r.methods.includes(event.request.method) && r.pattern.test(event.url.pathname)
		);
		if (!allowed) return json({ error: 'admin authentication required' }, { status: 401 });
	}
	return resolve(event);
};
