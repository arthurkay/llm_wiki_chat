// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Composer from '$lib/components/Composer.svelte';
import { wikiApi } from '$lib/api/wiki';

vi.mock('$lib/api/wiki', () => ({
	wikiApi: { upload: vi.fn() }
}));

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('Composer', () => {
	it('sends trimmed text on Enter and clears the box', async () => {
		const onSend = vi.fn();
		render(Composer, { props: { sending: false, onSend, onStop: () => {} } });
		const box = screen.getByPlaceholderText('Ask the wiki…');
		await fireEvent.input(box, { target: { value: '  hello wiki  ' } });
		await fireEvent.keyDown(box, { key: 'Enter' });
		expect(onSend).toHaveBeenCalledWith('hello wiki');
		expect((box as HTMLTextAreaElement).value).toBe('');
	});

	it('uses Shift+Enter for newlines instead of sending', async () => {
		const onSend = vi.fn();
		render(Composer, { props: { sending: false, onSend, onStop: () => {} } });
		const box = screen.getByPlaceholderText('Ask the wiki…');
		await fireEvent.input(box, { target: { value: 'line' } });
		await fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
		expect(onSend).not.toHaveBeenCalled();
	});

	it('disables send when empty and shows stop while sending', () => {
		const { container, rerender } = render(Composer, { props: { sending: false, onSend: () => {}, onStop: () => {} } });
		expect((screen.getByLabelText('Send') as HTMLButtonElement).disabled).toBe(true);
		void rerender({ sending: true, onSend: () => {}, onStop: () => {} });
		expect(screen.getByLabelText('Stop')).toBeTruthy();
		expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
	});

	it('calls onStop from the stop button', async () => {
		const onStop = vi.fn();
		render(Composer, { props: { sending: true, onSend: () => {}, onStop } });
		await fireEvent.click(screen.getByLabelText('Stop'));
		expect(onStop).toHaveBeenCalled();
	});

	it('uploads an attached source and reports status', async () => {
		vi.mocked(wikiApi.upload).mockResolvedValue({ id: '1', job_id: 'j' });
		render(Composer, { props: { sending: false, onSend: () => {}, onStop: () => {} } });
		const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File(['data'], 'a.txt', { type: 'text/plain' });
		await fireEvent.change(picker, { target: { files: [file] } });
		expect(vi.mocked(wikiApi.upload)).toHaveBeenCalledWith(file);
		expect(await screen.findByText(/queued for wiki ingest/)).toBeTruthy();
	});

	it('surfaces upload errors', async () => {
		vi.mocked(wikiApi.upload).mockRejectedValue(new Error('boom'));
		render(Composer, { props: { sending: false, onSend: () => {}, onStop: () => {} } });
		const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(picker, { target: { files: [new File(['x'], 'b.txt')] } });
		expect(await screen.findByText('boom')).toBeTruthy();
	});
});
