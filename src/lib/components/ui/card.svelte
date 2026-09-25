<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let { class: className = '', children }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn('bg-card text-card-foreground rounded-lg border shadow-sm', className)}>
	{@render children?.()}
</div>
