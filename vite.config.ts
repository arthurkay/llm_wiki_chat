import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Under Vitest, resolve the client Svelte runtime so @testing-library
		// can mount components (jsdom tests). Production builds are unaffected.
		conditions: process.env.VITEST ? ['browser'] : undefined
	},
	ssr: {
		// These use extensionless/runes imports; bundle them for SSR
		noExternal: ['lucide-svelte', 'mode-watcher', 'bits-ui', 'svelte-toolbelt']
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node',
		setupFiles: ['./src/tests/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/lib/**/*.ts', 'src/routes/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/lib/assets/**']
		}
	}
});
