// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import Toaster from '$lib/components/ui/toaster.svelte';
import { toasts } from '$lib/stores/toast.js';

afterEach(() => {
	cleanup();
	for (const t of get(toasts)) toasts.dismiss(t.id);
});

describe('Toaster', () => {
	it('renders pushed toasts and dismisses on click', async () => {
		render(Toaster, {});
		toasts.error('Upload failed', 'file too large');
		expect(await screen.findByText('Upload failed')).toBeTruthy();
		expect(screen.getByText('file too large')).toBeTruthy();
		await fireEvent.click(screen.getByLabelText('Dismiss'));
		expect(screen.queryByText('Upload failed')).toBeNull();
	});
});
