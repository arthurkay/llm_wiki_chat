<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { Menu } from 'lucide-svelte';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/button.svelte';

	let { children } = $props();
	let open = $state(false);
</script>

<div class="bg-background flex h-dvh">
	<!-- Desktop sidebar -->
	<aside class="hidden w-64 shrink-0 border-r md:block">
		<Sidebar currentPath={page.url.pathname} />
	</aside>

	<!-- Mobile drawer -->
	{#if open}
		<div class="fixed inset-0 z-50 md:hidden">
			<button aria-label="Close menu" class="absolute inset-0 bg-black/50" onclick={() => (open = false)}></button>
			<aside class="bg-background absolute top-0 left-0 h-full w-64 border-r shadow-lg">
				<Sidebar currentPath={page.url.pathname} onNavigate={() => (open = false)} />
			</aside>
		</div>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<header class="flex items-center gap-2 border-b px-4 py-2 md:hidden">
			<Button variant="ghost" size="icon" onclick={() => (open = true)} aria-label="Open menu">
				<Menu class="size-4" />
			</Button>
			<span class="text-sm font-semibold">Wiki Chat</span>
			<span class="flex-1"></span>
			<ThemeToggle />
		</header>

		<div class="min-h-0 flex-1 overflow-hidden">
			{@render children()}
		</div>
	</div>
</div>
