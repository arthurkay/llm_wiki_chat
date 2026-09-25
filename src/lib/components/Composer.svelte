<script lang="ts">
	import Button from '$lib/components/ui/button.svelte';
	import { Plus, ArrowUp, Square, Loader2 } from 'lucide-svelte';
	import { wikiApi } from '$lib/api/wiki';

	let {
		sending = false,
		onSend,
		onStop
	}: {
		sending?: boolean;
		onSend: (msg: string) => void;
		onStop: () => void;
	} = $props();

	let text = $state('');
	let area = $state<HTMLTextAreaElement | null>(null);
	let picker = $state<HTMLInputElement | null>(null);
	let notice = $state<string | null>(null);
	let attaching = $state(false);

	function autosize() {
		if (!area) return;
		area.style.height = 'auto';
		area.style.height = Math.min(area.scrollHeight, 200) + 'px';
	}

	function submit() {
		const msg = text.trim();
		if (!msg || sending) return;
		text = '';
		requestAnimationFrame(autosize);
		onSend(msg);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	async function onAttach(files: FileList | null) {
		const file = files?.[0];
		if (picker) picker.value = '';
		if (!file) return;
		attaching = true;
		notice = null;
		try {
			await wikiApi.upload(file);
			notice = `“${file.name}” queued for wiki ingest.`;
		} catch (e) {
			notice = e instanceof Error ? e.message : 'upload failed';
		} finally {
			attaching = false;
			setTimeout(() => (notice = null), 6000);
		}
	}
</script>

<div class="bg-card min-w-0 rounded-3xl border shadow-sm">
	{#if notice}
		<p class="text-muted-foreground px-5 pt-3 text-xs">{notice}</p>
	{/if}

	<textarea
		bind:this={area}
		bind:value={text}
		oninput={autosize}
		onkeydown={onKeydown}
		rows={1}
		placeholder="Ask the wiki…"
		class="placeholder:text-muted-foreground max-h-[200px] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed focus:outline-none"
	></textarea>

	<div class="flex min-w-0 items-center gap-1.5 px-3 pt-1 pb-3">
		<Button variant="ghost" size="icon" class="shrink-0 rounded-full" onclick={() => picker?.click()} disabled={attaching} aria-label="Attach source (pdf, txt, md)">
			{#if attaching}
				<Loader2 class="size-4 animate-spin" />
			{:else}
				<Plus class="size-4" />
			{/if}
		</Button>
		<input bind:this={picker} type="file" accept=".pdf,.txt,.md" class="hidden" onchange={(e) => onAttach(e.currentTarget.files)} />

		<span class="flex-1"></span>

		{#if sending}
			<Button size="icon" class="shrink-0 rounded-full" onclick={onStop} aria-label="Stop">
				<Square class="size-4 fill-current" />
			</Button>
		{:else}
			<Button size="icon" class="shrink-0 rounded-full" onclick={submit} disabled={!text.trim()} aria-label="Send">
				<ArrowUp class="size-4" />
			</Button>
		{/if}
	</div>
</div>
