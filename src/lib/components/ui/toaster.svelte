<script lang="ts">
	import { toasts, type Toast } from '$lib/stores/toast.js';
	import { X, CircleCheck, TriangleAlert, Info } from 'lucide-svelte';
	import { cn } from '$lib/utils.js';

	let items = $state<Toast[]>([]);

	$effect(() => {
		const unsub = toasts.subscribe((all) => (items = all));
		return unsub;
	});

	const styles: Record<Toast['variant'], string> = {
		default: 'border',
		success: 'border-green-500/50',
		error: 'border-destructive/50'
	};
</script>

<div class="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 md:left-auto md:w-96" role="status" aria-live="polite">
	{#each items as toast (toast.id)}
		<div class={cn('bg-card text-card-foreground pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-lg', styles[toast.variant])}>
			{#if toast.variant === 'success'}
				<CircleCheck class="size-4 shrink-0 text-green-500" />
			{:else if toast.variant === 'error'}
				<TriangleAlert class="size-4 shrink-0 text-red-500" />
			{:else}
				<Info class="size-4 shrink-0 opacity-60" />
			{/if}
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium break-words">{toast.title}</p>
				{#if toast.description}
					<p class="text-muted-foreground mt-0.5 text-xs break-words">{toast.description}</p>
				{/if}
			</div>
			<button class="hover:bg-accent shrink-0 rounded-md p-1" onclick={() => toasts.dismiss(toast.id)} aria-label="Dismiss">
				<X class="size-3.5" />
			</button>
		</div>
	{/each}
</div>
