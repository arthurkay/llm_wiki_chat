// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Markdown from '$lib/components/Markdown.svelte';

afterEach(() => cleanup());

describe('Markdown', () => {
	it('renders headings, bold and lists', () => {
		render(Markdown, { props: { content: '# Title\n\n**bold** text\n\n- one\n- two' } });
		const article = document.querySelector('.markdown-body');
		expect(article?.querySelector('h1')?.textContent).toBe('Title');
		expect(article?.querySelector('strong')?.textContent).toBe('bold');
		expect(article?.querySelectorAll('li')).toHaveLength(2);
	});

	it('renders fenced code and tables', () => {
		render(Markdown, { props: { content: '```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |' } });
		expect(document.querySelector('pre code')?.textContent).toContain('const a = 1;');
		expect(document.querySelectorAll('table')).toHaveLength(1);
	});

	it('strips scripts and event handlers (XSS)', () => {
		render(Markdown, {
			props: { content: 'hi <script>alert(1)</script><img src=x onerror=alert(2)>' }
		});
		expect(document.querySelector('script')).toBeNull();
		expect(document.body.innerHTML).not.toContain('onerror');
		expect(screen.getByText(/hi/)).toBeTruthy();
	});

	it('renders empty content without crashing', () => {
		render(Markdown, { props: { content: '' } });
		expect(document.querySelector('.markdown-body')).toBeTruthy();
	});
});
