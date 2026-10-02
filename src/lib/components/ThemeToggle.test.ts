// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { ModeWatcher } from 'mode-watcher';
import ThemeToggle from '$lib/components/ThemeToggle.svelte';

function stubMatchMedia(matches: boolean) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockReturnValue({
			matches,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		})
	});
}

beforeEach(() => {
	document.documentElement.classList.remove('dark');
	window.localStorage.clear();
	stubMatchMedia(false);
});

afterEach(() => cleanup());

describe('ThemeToggle', () => {
	it('cycles system -> dark -> light -> system, following the OS on system', async () => {
		// matchMedia stub reports matches:false, i.e. the OS prefers dark.
		render(ModeWatcher, {});
		render(ThemeToggle, {});
		expect(screen.getByLabelText(/Theme: system/)).toBeTruthy();
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		await fireEvent.click(screen.getByLabelText(/Theme: system/));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.getByLabelText(/Theme: dark/)).toBeTruthy();
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		await fireEvent.click(screen.getByLabelText(/Theme: dark/));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.getByLabelText(/Theme: light/)).toBeTruthy();
		expect(document.documentElement.classList.contains('dark')).toBe(false);

		await fireEvent.click(screen.getByLabelText(/Theme: light/));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.getByLabelText(/Theme: system/)).toBeTruthy();
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});
});
