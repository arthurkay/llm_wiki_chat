<script lang="ts">
	import { onMount } from 'svelte';
	import { wikiChat } from '$lib/stores/wikiChat';
	import Composer from '$lib/components/Composer.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import { BookOpen, TriangleAlert, Brain, ChevronDown } from 'lucide-svelte';
	import { cn } from '$lib/utils.js';

	let messages = $state<{ role: string; content: string; citations?: string[]; thinking?: string; thinkingOpen?: boolean }[]>([]);
	let sending = $state(false);
	let sessionError = $state<string | null>(null);
	let sessionId = $state<string | null>(null);
	let chatContainer: HTMLDivElement;
	// Stick to the bottom on new content — unless the user scrolled up.
	let stickToBottom = $state(true);
	const STICK_THRESHOLD_PX = 80;

	function scrollToBottom() {
		if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	function onScroll() {
		if (!chatContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = chatContainer;
		stickToBottom = scrollHeight - scrollTop - clientHeight < STICK_THRESHOLD_PX;
	}

	function send(text: string) {
		stickToBottom = true;
		wikiChat.send(text);
		// Show the outgoing message immediately, even before the store updates
		requestAnimationFrame(scrollToBottom);
	}

	onMount(() => {
		wikiChat.restore();
	});

	$effect(() => {
		const unsub = wikiChat.subscribe((s) => {
			messages = s.messages;
			sending = s.sending;
			sessionError = s.error;
			if (s.sessionId !== sessionId) {
				// Newly opened chat: start pinned to the bottom
				sessionId = s.sessionId;
				stickToBottom = true;
			}
		});
		return unsub;
	});

	// Follow new messages and streaming tokens while stuck to the bottom.
	// Reads messages/sending so the effect re-runs on every update.
	$effect(() => {
		void messages.length;
		void sending;
		for (const m of messages) {
			void m.content.length;
			void (m.thinking?.length ?? 0);
		}
		if (stickToBottom) scrollToBottom();
	});
</script>

<div class="flex h-full flex-col">
	<div bind:this={chatContainer} onscroll={onScroll} class="flex-1 space-y-4 overflow-x-clip overflow-y-auto p-4">
		{#if messages.length === 0}
			<div class="flex h-full flex-col items-center justify-center text-center">
				<span class="bg-muted mb-4 flex size-12 items-center justify-center rounded-lg">
					<BookOpen class="size-6" />
				</span>
				<h2 class="text-lg font-semibold">Ask the wiki</h2>
				<p class="text-muted-foreground mt-1 max-w-sm text-sm">Answers are compiled from wiki pages, with citations. Upload sources in Wiki Admin to grow the knowledge base.</p>
			</div>
		{:else}
			{#each messages as message, i}
				<div class={cn('flex min-w-0', message.role === 'user' ? 'justify-end' : 'justify-start')}>
					<div class={cn('bg-muted max-w-[85%] min-w-0 rounded-lg px-3.5 py-2.5 text-sm md:max-w-[80%]')}>
						{#if message.role === 'user'}
							<span class="whitespace-pre-wrap break-words">{message.content}</span>
						{:else}
							{#if message.thinking}
								<button
									class="text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1.5 text-xs"
									onclick={() => wikiChat.toggleThinking(i)}
									aria-label="Toggle reasoning"
								>
									<Brain class="size-3.5" />
									{message.content ? 'Thought' : 'Thinking…'}
									<ChevronDown class={cn('size-3.5 transition-transform', message.thinkingOpen && 'rotate-180')} />
								</button>
								{#if message.thinkingOpen}
									<div class="border-border mb-2 border-l-2 pl-3 opacity-80">
										<Markdown content={message.thinking} />
									</div>
								{/if}
							{/if}
							{#if message.content}
								<Markdown content={message.content} />
							{/if}
						{/if}
						{#if message.citations?.length}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each message.citations as cite}
									<Badge variant="outline" class="bg-background/50 max-w-full break-all">{cite}</Badge>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
			{#if sending && !messages.at(-1)?.content && !messages.at(-1)?.thinking}
				<div class="flex justify-start">
					<div class="bg-muted flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm">
						<span class="flex gap-1">
							<span class="size-1.5 animate-bounce rounded-full bg-current"></span>
							<span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]"></span>
							<span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]"></span>
						</span>
					</div>
				</div>
			{/if}
		{/if}
		{#if sessionError}
			<div class="border-destructive/50 bg-destructive/10 flex items-center gap-2 rounded-lg border p-3 text-sm">
				<TriangleAlert class="size-4 shrink-0" />
				{sessionError}
			</div>
		{/if}
	</div>

	<div class="p-4 pt-0">
		<Composer sending={sending} onSend={send} onStop={() => wikiChat.stop()} />
	</div>
</div>

<svelte:head>
	<title>Wiki Chat</title>
</svelte:head>
