import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// Must exceed the 20MB upload policy in src/lib/uploads.ts (+ multipart overhead).
		bodySizeLimit: 21 * 1024 * 1024,
		alias: {
			$tests: './src/tests'
		}
	}
};

export default config;
