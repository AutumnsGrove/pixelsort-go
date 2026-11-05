<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Settings as Gear } from '@lucide/svelte';
	import { updateDot } from '#lib/updater/state.svelte';

	let { readout = '' }: { readout?: string } = $props();
	const path = $derived(page.url.pathname);
</script>

<header class="top">
	<a class="word" href={resolve('/')}>pixelsort<i>go</i></a>
	{#if readout}<div class="read" data-testid="topread">{readout}</div>{/if}
	<nav class="links" aria-label="Main">
		<a class:on={path.startsWith('/studio')} href={resolve('/studio')}>Studio</a>
		<a class:on={path.startsWith('/archive')} href={resolve('/archive')}>Archive</a>
		<a
			class="gear"
			class:on={path.startsWith('/settings')}
			href={resolve('/settings')}
			aria-label={updateDot.ready ? 'Settings — an update is ready' : 'Settings'}
		>
			<Gear size={15} />{#if updateDot.ready}<i class="dot" data-testid="update-dot"></i>{/if}
		</a>
	</nav>
</header>

<style>
	.gear {
		position: relative;
	}
	.dot {
		position: absolute;
		right: -6px;
		top: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ver);
		box-shadow: 0 0 8px var(--ver);
	}
</style>
