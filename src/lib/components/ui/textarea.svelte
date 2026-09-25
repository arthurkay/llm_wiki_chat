<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		ref = $bindable<HTMLTextAreaElement | null>(null),
		class: className = '',
		...rest
	}: Omit<HTMLTextareaAttributes, 'class'> & {
		class?: string;
		value?: string;
		ref?: HTMLTextAreaElement | null;
	} = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	class={cn(
		'border-input bg-background ring-offset-background placeholder:text-muted-foreground flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-colors',
		'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none',
		'disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...rest}
></textarea>
