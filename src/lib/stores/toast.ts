import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	title: string;
	description?: string;
	variant: 'default' | 'error' | 'success';
}

let nextId = 1;
const DEFAULT_TIMEOUT = 5000;

function createToasts() {
	const { subscribe, update } = writable<Toast[]>([]);

	function dismiss(id: number) {
		update((all) => all.filter((t) => t.id !== id));
	}

	function push(title: string, opts: { description?: string; variant?: Toast['variant']; timeout?: number } = {}) {
		const id = nextId++;
		const toast: Toast = { id, title, description: opts.description, variant: opts.variant ?? 'default' };
		update((all) => [...all.slice(-3), toast]);
		setTimeout(() => dismiss(id), opts.timeout ?? DEFAULT_TIMEOUT);
		return id;
	}

	return {
		subscribe,
		dismiss,
		message: (title: string, description?: string) => push(title, { description }),
		success: (title: string, description?: string) => push(title, { description, variant: 'success' }),
		error: (title: string, description?: string) => push(title, { description, variant: 'error', timeout: 8000 })
	};
}

export const toasts = createToasts();
