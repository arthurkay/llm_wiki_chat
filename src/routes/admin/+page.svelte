<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { wikiApi, type WikiSource, type IngestJobRow, type WikiPageMeta, type ChatSettingsResponse } from '$lib/api/wiki';
	import Button from '$lib/components/ui/button.svelte';
	import { buttonClasses } from '$lib/components/ui/button.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import CardHeader from '$lib/components/ui/card-header.svelte';
	import CardTitle from '$lib/components/ui/card-title.svelte';
	import CardDescription from '$lib/components/ui/card-description.svelte';
	import CardContent from '$lib/components/ui/card-content.svelte';
	import Separator from '$lib/components/ui/separator.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Toaster from '$lib/components/ui/toaster.svelte';
	import { toasts } from '$lib/stores/toast.js';
	import { validateUploadFile, UPLOAD_ACCEPT_ATTR } from '$lib/uploads.js';
	import { Dialog, AlertDialog } from 'bits-ui';
	import { Upload, RefreshCw, Search, Loader2, TriangleAlert, ArrowLeft, Trash2, Save, Eye, X, Lock, LogOut } from 'lucide-svelte';

	let sources = $state<WikiSource[]>([]);
	let jobs = $state<IngestJobRow[]>([]);
	let pages = $state<WikiPageMeta[]>([]);
	let query = $state('');
	let results = $state<Array<{ path: string; title: string; body: string }>>([]);
	let uploading = $state(false);
	let error = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let settings = $state<ChatSettingsResponse | null>(null);
	let saving = $state(false);
	let savedAt = $state<string | null>(null);
	let modelOpen = $state(false);
	let viewing = $state<{ path: string; title: string; kind: string; body: string; sources: string; updated_at: string } | null>(null);
	let viewerOpen = $state(false);
	let confirmDialog = $state<{ title: string; description: string; confirmLabel: string; action: () => void } | null>(null);

	function askConfirm(title: string, description: string, confirmLabel: string, action: () => void) {
		confirmDialog = { title, description, confirmLabel, action };
	}
	let gate = $state<'checking' | 'open' | 'locked'>('checking');
	let password = $state('');
	let loggingIn = $state(false);

	const modelMatches = $derived.by(() => {
		const q = (settings?.chat_model ?? '').trim().toLowerCase();
		const all = settings?.models ?? [];
		if (!q) return all.slice(0, 50);
		return all.filter((m) => m.id.toLowerCase().includes(q)).slice(0, 50);
	});

	async function refresh() {
		try {
			[sources, jobs, pages] = await Promise.all([wikiApi.sources(), wikiApi.jobs(), wikiApi.pages()]);
		} catch (e) {
			fail(e, 'load failed');
		}
	}

	/** Report an action failure both inline and as a toast (visible on mobile). */
	function fail(e: unknown, fallback: string) {
		const message = e instanceof Error ? e.message : fallback;
		error = message;
		toasts.error(message);
	}

	async function loadSettings() {
		try {
			settings = await wikiApi.settings();
		} catch (e) {
			fail(e, 'settings load failed');
		}
	}

	async function saveSettings() {
		if (!settings || saving) return;
		saving = true;
		try {
			settings = await wikiApi.saveSettings({ chat_model: settings.chat_model, system_prompt: settings.system_prompt });
			savedAt = new Date().toLocaleTimeString();
			setTimeout(() => (savedAt = null), 4000);
			toasts.success('Settings saved');
		} catch (e) {
			fail(e, 'settings save failed');
		} finally {
			saving = false;
		}
	}

	onMount(() => {
		void checkGate().then(() => {
			if (gate !== 'locked') {
				refresh();
				loadSettings();
			}
		});
		const t = setInterval(() => {
			if (gate === 'open') refresh();
		}, 4000);
		return () => clearInterval(t);
	});

	async function checkGate() {
		try {
			const status = await wikiApi.adminStatus();
			if (!status.protected) {
				gate = 'open';
				return;
			}
			const session = await wikiApi.adminAuthed();
			gate = session.authed ? 'open' : 'locked';
		} catch {
			gate = 'locked';
		}
	}

	async function login(e: Event) {
		e.preventDefault();
		if (!password || loggingIn) return;
		loggingIn = true;
		error = null;
		try {
			await wikiApi.adminLogin(password);
			password = '';
			gate = 'open';
			refresh();
			loadSettings();
		} catch {
			error = 'Wrong password.';
		} finally {
			loggingIn = false;
		}
	}

	async function logout() {
		try {
			await wikiApi.adminLogout();
		} catch {
			/* ignore */
		}
		gate = 'locked';
		password = '';
	}

	async function handleUpload(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		const check = validateUploadFile(file.name, file.size);
		if (!check.ok) {
			if (fileInput) fileInput.value = '';
			fail(new Error(check.error), check.error);
			return;
		}
		uploading = true;
		error = null;
		try {
			await wikiApi.upload(file);
			if (fileInput) fileInput.value = '';
			toasts.success(`“${file.name}” queued for ingest`);
			await refresh();
		} catch (e) {
			fail(e, 'upload failed');
		} finally {
			uploading = false;
		}
	}

	async function handleSearch(e: Event) {
		e.preventDefault();
		if (!query.trim()) return;
		results = await wikiApi.search(query.trim());
	}

	async function handleDeleteSource(id: string, filename: string) {
		askConfirm('Delete source?', `"${filename}" and wiki pages derived only from it will be removed.`, 'Delete', async () => {
			try {
				const result = await wikiApi.deleteSource(id);
				toasts.success(`Deleted “${filename}”`, result.pages.length ? `+${result.pages.length} derived page(s)` : undefined);
				await refresh();
			} catch (e) {
				fail(e, 'delete failed');
			}
		});
	}

	async function handleDeletePage(path: string) {
		askConfirm('Delete page?', `"${path}" will be removed from the wiki.`, 'Delete', async () => {
			try {
				await wikiApi.deletePage(path);
				if (viewing?.path === path) viewerOpen = false;
				toasts.success(`Deleted ${path}`);
				await refresh();
			} catch (e) {
				fail(e, 'delete failed');
			}
		});
	}

	async function openViewer(path: string) {
		try {
			viewing = await wikiApi.getPage(path);
			viewerOpen = true;
		} catch (e) {
			fail(e, 'failed to load page');
		}
	}

	async function retryJob(jobId?: string) {
		try {
			const result = await wikiApi.retryJobs(jobId);
			if (result.retried.length === 0) {
				toasts.message('Nothing to retry');
			} else {
				toasts.success(`Requeued ${result.retried.length} failed job(s)`);
			}
			await refresh();
		} catch (e) {
			fail(e, 'retry failed');
		}
	}

	const failedJobs = $derived(jobs.filter((j) => j.status === 'failed'));

	function viewerSources(): string[] {
		try {
			const v = JSON.parse(viewing?.sources ?? '[]') as unknown;
			return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
		} catch {
			return [];
		}
	}

	function statusVariant(s: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		if (s === 'completed' || s === 'done') return 'default';
		if (s === 'failed') return 'destructive';
		return 'secondary';
	}
</script>

<div class="mx-auto w-full max-w-5xl overflow-x-clip overflow-y-auto p-4 md:p-6">
	<div class="mb-6 flex items-center gap-3">
		<Button variant="ghost" size="icon" onclick={() => goto('/chat')} aria-label="Back to chat">
			<ArrowLeft class="size-4" />
		</Button>
		<div class="min-w-0 flex-1">
			<h1 class="text-xl font-semibold tracking-tight md:text-2xl">Wiki Admin</h1>
			<p class="text-muted-foreground break-words text-sm">Upload sources, then worker compiles them.</p>
		</div>
		{#if gate === 'open'}
			<Button variant="ghost" size="icon" onclick={logout} aria-label="Log out of admin">
				<LogOut class="size-4" />
			</Button>
		{/if}
		<ThemeToggle />
	</div>

	{#if gate === 'checking'}
		<p class="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 class="size-4 animate-spin" /> Checking admin access…</p>
	{:else if gate === 'locked'}
		<Card class="mx-auto w-full max-w-sm">
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><Lock class="size-4" /> Admin locked</CardTitle>
				<CardDescription>Enter the admin password to manage the wiki.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onsubmit={login} class="space-y-3">
					<Input type="password" bind:value={password} placeholder="Admin password" autocomplete="current-password" />
					<Button type="submit" class="w-full" disabled={loggingIn || !password}>
						{loggingIn ? 'Checking…' : 'Unlock'}
					</Button>
				</form>
			</CardContent>
		</Card>
	{:else}

	{#if error}
		<div class="border-destructive/50 bg-destructive/10 mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm">
			<TriangleAlert class="size-4 shrink-0" />
			{error}
		</div>
	{/if}

	{#if settings}
		<Card class="mb-4 min-w-0">
			<CardHeader>
				<CardTitle>Chat settings</CardTitle>
				<CardDescription>Model and personality used by chat. Empty model = opencode server default.</CardDescription>
			</CardHeader>
			<CardContent class="min-w-0 space-y-4">
				<div class="min-w-0 space-y-2">
					<label class="text-sm font-medium" for="model-input">Model</label>
					<div class="relative min-w-0">
						<Input
							id="model-input"
							bind:value={settings.chat_model}
							onfocus={() => (modelOpen = true)}
							onblur={() => setTimeout(() => (modelOpen = false), 150)}
							oninput={() => (modelOpen = true)}
							placeholder="Search models or type provider/model…"
							class="min-w-0 font-mono text-xs"
							autocomplete="off"
						/>
						{#if modelOpen && modelMatches.length > 0}
							<ul class="bg-popover absolute z-50 mt-1 max-h-64 w-full min-w-0 overflow-x-clip overflow-y-auto rounded-md border shadow-md">
								{#if settings.chat_model.trim() === ''}
									<li>
										<button
											class="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm"
											onmousedown={(e) => e.preventDefault()}
											onclick={() => {
												if (settings) settings.chat_model = '';
												modelOpen = false;
											}}
										>
											Server default
										</button>
									</li>
								{/if}
								{#each modelMatches as m}
									<li>
										<button
											class="hover:bg-accent flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left"
											onmousedown={(e) => e.preventDefault()}
											onclick={() => {
												if (settings) settings.chat_model = m.id;
												modelOpen = false;
											}}
										>
											<span class="min-w-0 flex-1 truncate font-mono text-xs">{m.id}</span>
											<span class="text-muted-foreground shrink-0 text-xs">{m.provider}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
					{#if settings.models.length > 0}
						<p class="text-muted-foreground text-xs">{settings.models.length} models available — type to filter, or enter any provider/model. Empty = server default.</p>
					{:else if !settings.opencode}
						<Badge variant="destructive">opencode offline — model list unavailable</Badge>
					{/if}
				</div>
				<div class="min-w-0 space-y-2">
					<label class="text-sm font-medium" for="system-prompt">System prompt</label>
					<Textarea id="system-prompt" bind:value={settings.system_prompt} rows={8} class="min-w-0 font-mono text-xs" />
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Button onclick={saveSettings} disabled={saving}>
						<Save class="size-4" />
						{saving ? 'Saving…' : 'Save settings'}
					</Button>
					<Button
						variant="ghost"
						onclick={() => {
							if (settings) settings.system_prompt = settings.default_system_prompt;
						}}
					>
						Reset personality
					</Button>
					{#if savedAt}
						<span class="text-muted-foreground text-xs">Saved {savedAt}</span>
					{/if}
				</div>
			</CardContent>
		</Card>
	{/if}

	<div class="grid min-w-0 gap-4 md:grid-cols-2">
		<Card class="min-w-0">
			<CardHeader>
				<CardTitle>Upload source</CardTitle>
				<CardDescription>PDF, Markdown or text, up to 20MB.</CardDescription>
			</CardHeader>
			<CardContent class="min-w-0 space-y-4">
				<div class="flex min-w-0 gap-2">
					<Input bind:ref={fileInput} type="file" accept={UPLOAD_ACCEPT_ATTR} onchange={(e) => handleUpload(e.currentTarget.files)} disabled={uploading} class="min-w-0 flex-1" />
					<Button variant="outline" size="icon" class="shrink-0" onclick={() => wikiApi.runJobs()} aria-label="Retry worker">
						<RefreshCw class="size-4" />
					</Button>
				</div>
				{#if uploading}
					<p class="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 class="size-4 animate-spin" /> Uploading…</p>
				{/if}

				<Separator />

				<h3 class="text-sm font-medium">Sources ({sources.length})</h3>
				<ul class="space-y-1.5 text-sm">
					{#each sources as s}
						<li class="flex items-center justify-between gap-2">
							<span class="flex min-w-0 flex-1 items-center gap-2">
								<Upload class="text-muted-foreground size-3.5 shrink-0" />
								<span class="truncate">{s.filename}</span>
							</span>
							<Badge variant={statusVariant(s.status)} class="shrink-0">{s.status}</Badge>
							<Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => handleDeleteSource(s.id, s.filename)} aria-label={`Delete ${s.filename}`}>
								<Trash2 class="size-3.5" />
							</Button>
						</li>
					{/each}
					{#if sources.length === 0}
						<li class="text-muted-foreground text-sm">No sources yet.</li>
					{/if}
				</ul>

				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-medium">Jobs</h3>
					{#if failedJobs.length > 0}
						<Button variant="ghost" size="sm" onclick={() => retryJob()} class="h-7 gap-1 text-xs">
							<RefreshCw class="size-3.5" />
							Retry all failed ({failedJobs.length})
						</Button>
					{/if}
				</div>
				<ul class="space-y-2 text-sm">
					{#each jobs.slice(0, 10) as j}
						<li class="min-w-0">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 flex-1 truncate">{j.filename}</span>
								<Badge variant={j.status === 'failed' ? 'destructive' : 'outline'} class="shrink-0">{j.status}</Badge>
								{#if j.status === 'failed'}
									<Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => retryJob(j.id)} aria-label={`Retry ${j.filename}`}>
										<RefreshCw class="size-3.5" />
									</Button>
								{/if}
							</div>
							{#if j.status === 'failed' && j.error}
								<p class="text-muted-foreground mt-0.5 text-xs break-words">Reason: {j.error}</p>
							{/if}
						</li>
					{/each}
					{#if jobs.length === 0}
						<li class="text-muted-foreground text-sm">No jobs yet.</li>
					{/if}
				</ul>
			</CardContent>
		</Card>

		<Card class="min-w-0">
			<CardHeader>
				<CardTitle>Search wiki</CardTitle>
				<CardDescription>Full-text search over compiled pages.</CardDescription>
			</CardHeader>
			<CardContent class="min-w-0 space-y-4">
				<form onsubmit={handleSearch} class="flex min-w-0 gap-2">
					<Input bind:value={query} placeholder="Search pages…" class="min-w-0 flex-1" />
					<Button type="submit" size="icon" class="shrink-0" aria-label="Search">
						<Search class="size-4" />
					</Button>
				</form>
				<ul class="space-y-3 text-sm">
				{#each results as r}
						<li class="min-w-0">
							<button class="block w-full min-w-0 text-left" onclick={() => openViewer(r.path)}>
								<div class="font-mono text-xs break-all opacity-60">{r.path}</div>
								<div class="font-medium break-words">{r.title}</div>
								<p class="text-muted-foreground line-clamp-3 break-words">{r.body.slice(0, 300)}</p>
							</button>
						</li>
					{/each}
				</ul>

				<Separator />

				<h3 class="text-sm font-medium">Pages ({pages.length})</h3>
				<ul class="max-h-96 space-y-1.5 overflow-y-auto text-sm">
					{#each pages as p}
						<li class="flex items-center justify-between gap-2">
							<button class="hover:text-foreground text-muted-foreground min-w-0 flex-1 truncate text-left font-mono text-xs" onclick={() => openViewer(p.path)} title="View page">
								{p.path}
							</button>
							<Badge variant="outline" class="shrink-0">{p.kind}</Badge>
							<Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => openViewer(p.path)} aria-label={`View ${p.path}`}>
								<Eye class="size-3.5" />
							</Button>
							<Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => handleDeletePage(p.path)} aria-label={`Delete ${p.path}`}>
								<Trash2 class="size-3.5" />
							</Button>
						</li>
					{/each}
					{#if pages.length === 0}
						<li class="text-muted-foreground text-sm">Wiki is empty — upload a source to begin.</li>
					{/if}
				</ul>
			</CardContent>
		</Card>
	</div>

	<Dialog.Root bind:open={viewerOpen}>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
			<Dialog.Content
				class="bg-background fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl min-w-0 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border shadow-lg"
			>
				{#if viewing}
					<div class="flex min-w-0 items-start gap-2 border-b p-4">
						<div class="min-w-0 flex-1">
							<Dialog.Title class="truncate text-base font-semibold">{viewing.title}</Dialog.Title>
							<Dialog.Description class="mt-0.5 truncate font-mono text-xs opacity-60">{viewing.path}</Dialog.Description>
						</div>
						<Dialog.Close class="hover:bg-accent shrink-0 rounded-md p-1" aria-label="Close viewer">
							<X class="size-4" />
						</Dialog.Close>
					</div>
					<div class="flex flex-wrap gap-1.5 px-4 pt-3">
						<Badge variant="outline">{viewing.kind}</Badge>
						{#each viewerSources() as s}
							<Badge variant="secondary" class="max-w-full break-all">{s}</Badge>
						{/each}
					</div>
					<div class="min-w-0 flex-1 overflow-x-clip overflow-y-auto p-4">
						<Markdown content={viewing.body} />
					</div>
					<div class="flex items-center justify-between gap-2 border-t p-3">
						<span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">updated {viewing.updated_at}</span>
						<Button
							variant="destructive"
							size="sm"
							onclick={() => {
								const p = viewing?.path;
								if (p) handleDeletePage(p);
							}}
						>
							<Trash2 class="size-4" />
							Delete page
						</Button>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>

	<AlertDialog.Root open={confirmDialog !== null} onOpenChange={(open) => { if (!open) confirmDialog = null; }}>
		<AlertDialog.Portal>
			<AlertDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
			<AlertDialog.Content
				class="bg-background fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md min-w-0 -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg"
			>
				<div class="flex flex-col gap-2">
					<AlertDialog.Title class="text-lg font-semibold">{confirmDialog?.title}</AlertDialog.Title>
					<AlertDialog.Description class="text-muted-foreground text-sm break-words">
						{confirmDialog?.description}
					</AlertDialog.Description>
				</div>
				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<AlertDialog.Cancel class={buttonClasses('outline')}>
						Cancel
					</AlertDialog.Cancel>
					<AlertDialog.Action
						class={buttonClasses('destructive')}
						onclick={() => {
							const action = confirmDialog?.action;
							confirmDialog = null;
							action?.();
						}}
					>
						{confirmDialog?.confirmLabel ?? 'Confirm'}
					</AlertDialog.Action>
				</div>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>
	{/if}
	<Toaster />
</div>
