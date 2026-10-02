<script lang="ts">
	import { userPrefersMode, setMode } from 'mode-watcher';
	import Button from '$lib/components/ui/button.svelte';
	import { Sun, Moon, Monitor } from 'lucide-svelte';

	const order = ['light', 'system', 'dark'] as const;
	const choice = $derived(userPrefersMode.current ?? 'system');

	function cycle() {
		setMode(order[(order.indexOf(choice) + 1) % order.length]);
	}
</script>

<Button variant="ghost" size="icon" onclick={cycle} aria-label="Theme: {choice} (click to change)">
	{#if choice === 'light'}
		<Sun class="size-4" />
	{:else if choice === 'dark'}
		<Moon class="size-4" />
	{:else}
		<Monitor class="size-4" />
	{/if}
</Button>
