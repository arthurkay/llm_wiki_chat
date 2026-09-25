<script lang="ts">
	import { toggleMode } from 'mode-watcher';
	import Button from '$lib/components/ui/button.svelte';
	import { Sun, Moon } from 'lucide-svelte';
</script>

<Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
	<Sun class="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
	<Moon class="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
</Button>
