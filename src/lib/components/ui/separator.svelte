<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let { class: className = '', children }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn('bg-border -mx-1 my-1 h-px', className)}>
	{@render children?.()}
</div>
