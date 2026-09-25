<script lang="ts" module>
	import { cn } from '$lib/utils.js';

	export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
	const variants: Record<BadgeVariant, string> = {
		default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/80',
		secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
		outline: 'text-foreground border border-input',
		destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/80'
	};
	export function badgeClasses(variant: BadgeVariant = 'default', className = ''): string {
		return cn(
			'inline-flex items-center rounded-md border border-transparent px-2 py-0.5 text-xs font-semibold transition-colors',
			variants[variant],
			className
		);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { variant = 'default', class: className = '', children }: { variant?: BadgeVariant; class?: string; children?: Snippet } = $props();
</script>

<span class={badgeClasses(variant, className)}>
	{@render children?.()}
</span>
