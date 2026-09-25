// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Sidebar from '$lib/components/Sidebar.svelte';
import { wikiChat } from '$lib/stores/wikiChat';

const historyRows = [{ role: 'user', content: 'hi', citations: '[]' }];

function mockFetch() {
	return vi.fn(async (input: unknown) => {
		const url = String(input);
		if (url === '/api/chat' || url.startsWith('/api/chat?ids=')) {
			return Response.json([{ id: 's1', title: 'First chat', message_count: 1, opencode_session_id: 'o1', created_at: '', last_message_at: '' }]);
		}
		if (url.startsWith('/api/chat?sessionId=')) return Response.json(historyRows);
		throw new Error('unexpected fetch ' + url);
	});
}

beforeEach(() => {
	window.localStorage.clear();
	vi.unstubAllGlobals();
});

afterEach(() => cleanup());

describe('Sidebar', () => {
	it('renders nav links and an empty history state', () => {
		render(Sidebar, { props: { currentPath: '/chat' } });
		expect(screen.getByText('Chat')).toBeTruthy();
		expect(screen.getByText('Wiki Admin')).toBeTruthy();
		expect(screen.getByText('No chats yet.')).toBeTruthy();
	});

	it('lists sessions and opens one on click', async () => {
		vi.stubGlobal('fetch', mockFetch());
		render(Sidebar, { props: { currentPath: '/chat' } });
		await wikiChat.loadSessions();
		expect(await screen.findByText('First chat')).toBeTruthy();
		await fireEvent.click(screen.getByText('First chat'));
		// drawer navigation hook fires without error
	});

	it('starts a new chat from the New button', async () => {
		vi.stubGlobal('fetch', mockFetch());
		const onNavigate = vi.fn();
		render(Sidebar, { props: { currentPath: '/chat', onNavigate } });
		await wikiChat.loadSessions();
		await fireEvent.click(screen.getByText('New'));
		expect(onNavigate).toHaveBeenCalled();
		expect(screen.queryByText('First chat')).toBeNull();
	});
});
