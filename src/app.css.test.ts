import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

describe('theme contract', () => {
	it('uses a class-based dark variant so dark: utilities follow the app theme, not the OS', () => {
		// Mode-watcher toggles `.dark` on <html> (tracking the OS on "system").
		// Without this, OS-dark + app-light inverted the chat prose to near-white.
		expect(css).toMatch(/@custom-variant\s+dark\s+\(&:where\(\.dark,\s*\.dark \*\)\)/);
	});
});
