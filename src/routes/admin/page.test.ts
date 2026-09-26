// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import AdminPage from './+page.svelte';
import { wikiApi } from '$lib/api/wiki';

vi.mock('$lib/api/wiki', () => ({
	wikiApi: {
		sources: vi.fn(),
		jobs: vi.fn(),
		pages: vi.fn(),
		settings: vi.fn(),
		saveSettings: vi.fn(),
		deleteSource: vi.fn(),
		deletePage: vi.fn(),
		getPage: vi.fn(),
		search: vi.fn(),
		upload: vi.fn(),
		runJobs: vi.fn(),
		adminStatus: vi.fn(),
		adminLogin: vi.fn(),
		adminAuthed: vi.fn(),
		adminLogout: vi.fn()
	}
}));

const mocked = vi.mocked(wikiApi);

beforeEach(() => {
	vi.clearAllMocks();
	mocked.adminStatus.mockResolvedValue({ protected: false });
	mocked.sources.mockResolvedValue([{ id: 's1', filename: 'a.pdf', file_type: 'pdf', file_size: 10, status: 'completed', created_at: '' }]);
	mocked.jobs.mockResolvedValue([]);
	mocked.pages.mockResolvedValue([{ path: 'sources/a.md', title: 'A', kind: 'source', updated_at: '' }]);
	mocked.settings.mockResolvedValue({ chat_model: '', system_prompt: 'sys', models: [], opencode: false, default_system_prompt: 'sys' });
});

afterEach(() => cleanup());

describe('admin page', () => {
	it('asks for confirmation through a dialog before deleting a source', async () => {
		mocked.deleteSource.mockResolvedValue({ deleted: 's1', pages: [] });
		render(AdminPage, {});
		await waitFor(() => expect(screen.getByText('a.pdf')).toBeTruthy());
		expect(screen.queryByText('Delete source?')).toBeNull();

		await fireEvent.click(screen.getByLabelText('Delete a.pdf'));
		expect(await screen.findByText('Delete source?')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(mocked.deleteSource).toHaveBeenCalledWith('s1'));
	});

	it('cancelling keeps the source', async () => {
		render(AdminPage, {});
		await waitFor(() => expect(screen.getByText('a.pdf')).toBeTruthy());
		await fireEvent.click(screen.getByLabelText('Delete a.pdf'));
		await screen.findByText('Delete source?');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(mocked.deleteSource).not.toHaveBeenCalled();
	});

	it('shows the lock screen when admin is protected', async () => {
		mocked.adminStatus.mockResolvedValue({ protected: true });
		mocked.adminAuthed.mockResolvedValue({ authed: false });
		render(AdminPage, {});
		expect(await screen.findByText('Admin locked')).toBeTruthy();
		expect(mocked.sources).not.toHaveBeenCalled();
	});

	it('unlocks with the right password', async () => {
		mocked.adminStatus.mockResolvedValue({ protected: true });
		mocked.adminAuthed.mockResolvedValue({ authed: false });
		mocked.adminLogin.mockResolvedValue({ ok: true });
		render(AdminPage, {});
		await screen.findByText('Admin locked');
		await fireEvent.input(screen.getByPlaceholderText('Admin password'), { target: { value: 'pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
		await waitFor(() => expect(mocked.adminLogin).toHaveBeenCalledWith('pw'));
		await waitFor(() => expect(mocked.sources).toHaveBeenCalled());
	});

	it('shows the failure reason under failed jobs', async () => {
		mocked.jobs.mockResolvedValue([
			{ id: 'j1', source_id: 's1', status: 'failed', error: 'opencode: prompt_async failed (overloaded)', created_at: '', filename: 'big.pdf' }
		]);
		render(AdminPage, {});
		expect(await screen.findByText('failed')).toBeTruthy();
		expect(screen.getByText(/Reason: opencode: prompt_async failed/)).toBeTruthy();
	});
});
