<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Settings as Gear } from '@lucide/svelte';

	let { readout = '' }: { readout?: string } = $props();
	const path = $derived(page.url.pathname);
</script>

<header class="top">
	<a class="word" href={resolve('/')}>pixelsort<i>go</i></a>
	{#if readout}<div class="read" data-testid="topread">{readout}</div>{/if}
	<nav class="links" aria-label="Main">
		<a class:on={path.startsWith('/studio')} href={resolve('/studio')}>Studio</a>
		<a class:on={path.startsWith('/archive')} href={resolve('/archive')}>Archive</a>
		<a class:on={path.startsWith('/settings')} href={resolve('/settings')} aria-label="Settings"><Gear size={15} /></a>
	</nav>
</header>
