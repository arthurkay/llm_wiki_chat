import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// NOTE: bodySizeLimit here is NOT honored by @sveltejs/adapter-node 5.x —
		// the built handler reads BODY_SIZE_LIMIT env (default 512K) instead.
		// Upload ceiling is enforced via that env var (see DEPLOY.md) plus the
		// 20MB policy in src/lib/uploads.ts.
		alias: {
			$tests: './src/tests'
		}
	}
};

export default config;
