<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		ref = $bindable<HTMLInputElement | null>(null),
		class: className = '',
		...rest
	}: Omit<HTMLInputAttributes, 'class'> & {
		class?: string;
		value?: string;
		ref?: HTMLInputElement | null;
	} = $props();
</script>

<input
	bind:this={ref}
	bind:value
	class={cn(
		'border-input bg-background ring-offset-background placeholder:text-muted-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors',
		'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none',
		'disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...rest}
/>
