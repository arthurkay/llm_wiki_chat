<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Loader2 } from 'lucide-svelte';

	// Single-user wiki app: no login. Go straight to chat.
	onMount(() => {
		goto('/chat');
	});
</script>

<div class="bg-background flex min-h-screen items-center justify-center">
	<p class="text-muted-foreground flex items-center gap-2 text-sm">
		<Loader2 class="size-4 animate-spin" /> Loading wiki chat…
	</p>
</div>
