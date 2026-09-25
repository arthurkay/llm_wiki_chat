// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Button from '$lib/components/ui/button.svelte';
import Badge from '$lib/components/ui/badge.svelte';
import Card from '$lib/components/ui/card.svelte';
import CardHeader from '$lib/components/ui/card-header.svelte';
import CardTitle from '$lib/components/ui/card-title.svelte';
import CardDescription from '$lib/components/ui/card-description.svelte';
import CardContent from '$lib/components/ui/card-content.svelte';
import Input from '$lib/components/ui/input.svelte';
import Textarea from '$lib/components/ui/textarea.svelte';
import Separator from '$lib/components/ui/separator.svelte';
import { buttonClasses, type ButtonVariant, type ButtonSize } from '$lib/components/ui/button.svelte';
import { badgeClasses } from '$lib/components/ui/badge.svelte';

afterEach(() => cleanup());

describe('buttonClasses', () => {
	it.each([
		['default', 'default'],
		['secondary', 'sm'],
		['outline', 'lg'],
		['ghost', 'icon'],
		['destructive', 'default'],
		['link', 'sm']
	] as Array<[ButtonVariant, ButtonSize]>)('variant %s size %s', (variant, size) => {
		const cls = buttonClasses(variant, size);
		expect(cls).toContain('inline-flex');
		expect(cls).toContain('rounded-md');
	});

	it('appends custom classes', () => {
		expect(buttonClasses('default', 'default', 'my-cls')).toContain('my-cls');
	});
});

describe('badgeClasses', () => {
	it('covers all variants', () => {
		for (const v of ['default', 'secondary', 'outline', 'destructive'] as const) {
			expect(badgeClasses(v)).toContain('rounded-md');
		}
	});
});

describe('ui primitives render', () => {
	it('button renders children and forwards clicks', async () => {
		let clicked = 0;
		const { container } = render(Button, { props: { variant: 'destructive', onclick: () => clicked++ } as never });
		const btn = container.querySelector('button');
		expect(btn?.className).toContain('bg-destructive');
		btn?.click();
		expect(clicked).toBe(1);
	});

	it('badge renders text', () => {
		render(Badge, { props: { variant: 'secondary' } });
		expect(document.querySelector('span')?.className).toContain('bg-secondary');
	});

	it('card composes header/title/description/content', () => {
		const { container } = render(Card, {});
		expect(container.querySelector('div')?.className).toContain('bg-card');
		render(CardHeader, {});
		render(CardTitle, {});
		render(CardDescription, {});
		render(CardContent, {});
		expect(document.body.textContent).toBeDefined();
	});

	it('input binds value and ref', () => {
		let value = 'hello';
		let ref: HTMLInputElement | null = null;
		render(Input, {
			props: {
				get value() {
					return value;
				},
				set value(v: string) {
					value = v;
				},
				get ref() {
					return ref;
				},
				set ref(v: HTMLInputElement | null) {
					ref = v;
				}
			}
		} as never);
		expect(ref).toBeInstanceOf(HTMLInputElement);
		expect(screen.getByDisplayValue('hello')).toBeTruthy();
	});

	it('textarea binds value', () => {
		render(Textarea, { props: { value: 'notes', rows: 3 } });
		expect(screen.getByDisplayValue('notes')).toBeTruthy();
	});

	it('separator renders', () => {
		const { container } = render(Separator, {});
		expect(container.querySelector('div')?.className).toContain('bg-border');
	});
});
