import { describe, it, expect } from 'vitest';
import { cn } from '$lib/utils.js';

describe('cn', () => {
	it('merges class names', () => {
		expect(cn('a', 'b')).toBe('a b');
	});

	it('resolves tailwind conflicts with the last value winning', () => {
		expect(cn('px-2 px-4')).toBe('px-4');
	});

	it('skips falsy values', () => {
		expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
	});
});
