<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';

	let { content = '' }: { content?: string } = $props();

	marked.setOptions({ breaks: true, gfm: true });

	const html = $derived(DOMPurify.sanitize(marked.parse(content) as string));
</script>

<div class="markdown-body prose prose-sm dark:prose-invert max-w-none break-words">
	{@html html}
</div>

<style>
	.markdown-body :global(pre) {
		overflow-x: auto;
		max-width: 100%;
	}
	.markdown-body :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
	}
	.markdown-body :global(p:last-child) {
		margin-bottom: 0;
	}
</style>
