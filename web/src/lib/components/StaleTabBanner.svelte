<script lang="ts">
	import { onMount } from 'svelte';
	import { staleTab } from '#lib/updater';

	// A tab opened before an update keeps the old page and the old WASM engine. The page remembers the version it
	// loaded; when /healthz reports a different one it offers a reload instead of carrying on with a mismatched engine.
	let loaded = $state<string | null>(null);
	let serving = $state<string | null>(null);
	const stale = $derived(staleTab(loaded, serving));

	async function read(): Promise<string | null> {
		try {
			const res = await fetch('/healthz', { cache: 'no-store' });
			const body = (await res.json()) as { version?: string };
			return body.version ?? null;
		} catch {
			return null; // restarting or offline: say nothing
		}
	}
	async function check(): Promise<void> {
		const v = await read();
		if (v) serving = v;
	}

	onMount(() => {
		void read().then((v) => {
			loaded = v;
			serving = v;
		});
		const timer = setInterval(() => void check(), 5 * 60 * 1000);
		const onVisible = () => document.visibilityState === 'visible' && void check();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

{#if stale}
	<div class="stale glass" role="status" data-testid="stale-banner">
		<span>A newer version is ready.</span>
		<button class="btn sm pri" type="button" onclick={() => location.reload()}>Reload</button>
	</div>
{/if}

<style>
	.stale {
		position: fixed;
		left: 50%;
		top: 70px;
		transform: translateX(-50%);
		z-index: 120;
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 10px 14px 10px 20px;
		border-radius: 999px;
		font-size: 12px;
	}
</style>
