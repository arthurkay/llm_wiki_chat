import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts } from '$lib/stores/toast.js';

beforeEach(() => {
	vi.useFakeTimers();
	for (const t of get(toasts)) toasts.dismiss(t.id);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('toast store', () => {
	it('pushes and auto-dismisses messages', () => {
		toasts.message('hello', 'world');
		expect(get(toasts)).toHaveLength(1);
		expect(get(toasts)[0]).toMatchObject({ title: 'hello', description: 'world', variant: 'default' });
		vi.advanceTimersByTime(5000);
		expect(get(toasts)).toHaveLength(0);
	});

	it('keeps errors longer and supports manual dismiss', () => {
		const id = toasts.error('boom', 'details');
		expect(get(toasts)[0]).toMatchObject({ variant: 'error' });
		vi.advanceTimersByTime(5000);
		expect(get(toasts)).toHaveLength(1);
		toasts.dismiss(id);
		expect(get(toasts)).toHaveLength(0);
	});

	it('caps the stack, newest survive', () => {
		toasts.success('ok');
		for (let i = 0; i < 5; i++) toasts.message(`m${i}`);
		const all = get(toasts);
		expect(all).toHaveLength(4);
		expect(all.map((t) => t.title)).toEqual(['m1', 'm2', 'm3', 'm4']);
	});
});
