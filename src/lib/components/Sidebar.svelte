<script lang="ts">
	import { MessageSquare, Settings2, BookOpen, SquarePen, MessageCircle } from 'lucide-svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { wikiChat } from '$lib/stores/wikiChat';
	import type { ChatSession } from '$lib/api/wiki';
	import { cn } from '$lib/utils.js';

	let { currentPath = '/', onNavigate }: { currentPath?: string; onNavigate?: () => void } = $props();

	let sessionId = $state<string | null>(null);
	let sessions = $state<ChatSession[]>([]);

	$effect(() => {
		const unsub = wikiChat.subscribe((s) => {
			sessionId = s.sessionId;
			sessions = s.sessions;
		});
		return unsub;
	});

	const links = [
		{ href: '/chat', label: 'Chat', icon: MessageSquare },
		{ href: '/admin', label: 'Wiki Admin', icon: Settings2 }
	];
</script>

<div class="flex min-h-full w-64 flex-col gap-2 p-4">
	<a href="/chat" class="flex items-center gap-2 px-2 py-1">
		<span class="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
			<BookOpen class="size-4" />
		</span>
		<span class="text-sm font-semibold">Wiki Chat</span>
	</a>

	<nav class="flex flex-col gap-1">
		{#each links as link}
			{@const Icon = link.icon}
			{@const active = currentPath === link.href}
			<a
				href={link.href}
				onclick={() => onNavigate?.()}
				class={cn(
					'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
					active ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
				)}
			>
				<Icon class="size-4" />
				{link.label}
			</a>
		{/each}
	</nav>

	<div class="mt-2 flex min-h-0 flex-col gap-1">
		<div class="flex items-center justify-between px-2">
			<span class="text-muted-foreground text-xs font-medium">History</span>
			<button
				class="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md px-1 py-0.5 text-xs"
				onclick={() => {
					wikiChat.newChat();
					onNavigate?.();
				}}
				aria-label="New chat"
			>
				<SquarePen class="size-3.5" />
				New
			</button>
		</div>
		<div class="max-h-64 min-h-0 flex-col gap-0.5 overflow-y-auto">
			{#each sessions as s}
				<button
					class={cn(
						'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
						s.id === sessionId ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
					)}
					onclick={() => {
						wikiChat.open(s.id);
						onNavigate?.();
					}}
					title={s.title ?? 'Untitled chat'}
				>
					<MessageCircle class="size-3.5 shrink-0" />
					<span class="min-w-0 flex-1 truncate">{s.title || 'Untitled chat'}</span>
				</button>
			{/each}
			{#if sessions.length === 0}
				<p class="text-muted-foreground px-2 py-1 text-xs">No chats yet.</p>
			{/if}
		</div>
	</div>

	<div class="mt-auto flex items-center justify-between px-1">
		<p class="text-muted-foreground text-xs">single-user · local wiki</p>
		<ThemeToggle />
	</div>
</div>
