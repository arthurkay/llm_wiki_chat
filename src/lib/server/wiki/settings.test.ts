import { describe, it, expect } from 'vitest';
import { useTempWiki } from '../../../tests/tmpwiki.js';
import { getSettings, updateSettings, parseModel, parseAgent, DEFAULT_SYSTEM_PROMPT } from '$lib/server/wiki/settings.js';

useTempWiki();

describe('chat settings', () => {
	it('returns code defaults when nothing is stored', () => {
		const s = getSettings();
		expect(s.chat_model).toBe('');
		expect(s.chat_agent).toBe('');
		expect(s.system_prompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(DEFAULT_SYSTEM_PROMPT).toMatch(/wiki/i);
	});

	it('round-trips updates', () => {
		updateSettings({ chat_model: 'opencode/mimo-v2.6-flash-free' });
		expect(getSettings().chat_model).toBe('opencode/mimo-v2.6-flash-free');
		updateSettings({ system_prompt: 'Be terse.' });
		const s = getSettings();
		expect(s.system_prompt).toBe('Be terse.');
		expect(s.chat_model).toBe('opencode/mimo-v2.6-flash-free');
		updateSettings({ chat_agent: 'wiki-readonly' });
		expect(getSettings().chat_agent).toBe('wiki-readonly');
	});

	it('ignores non-string values', () => {
		updateSettings({ chat_model: 42 as unknown as string });
		expect(getSettings().chat_model).toBe('');
	});
});

describe('parseModel', () => {
	it.each([
		['opencode/mimo-v2.6-flash-free', { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' }],
		['deepinfra/tencent/Hy3', { providerID: 'deepinfra', modelID: 'tencent/Hy3' }],
		['', undefined],
		['noprovider', undefined],
		['/noname', undefined],
		['provider/', undefined]
	])('parses %s', (input, expected) => {
		expect(parseModel(input)).toEqual(expected);
	});
});

describe('parseAgent', () => {
	it.each([
		['wiki-readonly', 'wiki-readonly'],
		['  plan  ', 'plan'],
		['', undefined],
		['   ', undefined]
	])('parses %s', (input, expected) => {
		expect(parseAgent(input)).toEqual(expected);
	});
});
