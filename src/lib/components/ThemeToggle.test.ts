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
	it('renders and toggles the dark class', async () => {
		render(ModeWatcher, {});
		render(ThemeToggle, {});
		const btn = screen.getByLabelText('Toggle theme');
		const initial = document.documentElement.classList.contains('dark');
		await fireEvent.click(btn);
		await new Promise((r) => setTimeout(r, 50));
		expect(document.documentElement.classList.contains('dark')).toBe(!initial);
		await fireEvent.click(btn);
		await new Promise((r) => setTimeout(r, 50));
		expect(document.documentElement.classList.contains('dark')).toBe(initial);
	});
});
