<script lang="ts" module>
	import { cn } from '$lib/utils.js';

	export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
	export type ButtonSize = 'sm' | 'default' | 'lg' | 'icon';

	const variants: Record<ButtonVariant, string> = {
		default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
		secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
		outline: 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
		ghost: 'hover:bg-accent hover:text-accent-foreground',
		destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
		link: 'text-primary underline-offset-4 hover:underline'
	};
	const sizes: Record<ButtonSize, string> = {
		sm: 'h-8 gap-1.5 px-3 text-xs',
		default: 'h-9 px-4 py-2',
		lg: 'h-10 px-6',
		icon: 'size-9'
	};

	export function buttonClasses(variant: ButtonVariant = 'default', size: ButtonSize = 'default', className = ''): string {
		return cn(
			'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
			'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
			'[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
			variants[variant],
			sizes[size],
			className
		);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		variant = 'default',
		size = 'default',
		class: className = '',
		children,
		...rest
	}: Omit<HTMLButtonAttributes, 'class'> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<button class={buttonClasses(variant, size, className)} {...rest}>
	{@render children?.()}
</button>
