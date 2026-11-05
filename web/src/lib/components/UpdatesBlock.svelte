<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { UpdateController } from '#lib/updater/controller';
	import { HttpUpdateClient } from '#lib/updater/http-client';
	import { appBusy, rememberUpdateWaiting } from '#lib/updater/state.svelte';
	import type { View } from '#lib/updater';

	let view = $state<View>({ kind: 'loading' });
	let version = $state('');
	let error = $state('');
	let c: UpdateController | undefined;

	onMount(() => {
		c = new UpdateController({
			client: new HttpUpdateClient(),
			busy: () => ({ exporting: appBusy.exporting, saving: appBusy.saving }),
			onView: (v) => {
				view = v;
				rememberUpdateWaiting(c?.updateWaiting ?? null);
			},
			onReload: () => setTimeout(() => location.reload(), 1200)
		});
		void c.start();
		void new HttpUpdateClient()
			.getVersion()
			.then((i) => (version = i.version))
			.catch(() => {});
	});
	onDestroy(() => c?.stop());

	async function act(f: () => Promise<void> | undefined): Promise<void> {
		error = '';
		try {
			await f();
		} catch (e) {
			error = (e as Error).message;
		}
	}
	const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '');
</script>

<section class="glass card" aria-labelledby="up-h" data-testid="updates">
	<h3 id="up-h">Updates</h3>
	{#if version}<p class="sub">Running <code>{version}</code></p>{/if}

	<div role="status" aria-live="polite" data-testid="update-state" data-kind={view.kind}>
		{#if view.kind === 'loading'}
			<p>Looking…</p>
		{:else if view.kind === 'no_updater'}
			<p>{view.stale ? 'The update watcher has gone quiet.' : 'Updates aren’t set up on this server.'}</p>
			<p class="sub">Nothing here can update the app by itself until the watcher is installed (docs/deploy.md).</p>
		{:else if view.kind === 'checking'}
			<p>Checking for a newer version…</p>
		{:else if view.kind === 'up_to_date'}
			<p>Up to date.</p>
			{#if view.checkedAt}<p class="sub">Last checked {fmt(view.checkedAt)}</p>{/if}
			<button class="btn" type="button" onclick={() => act(() => c?.check())}>Check for updates</button>
		{:else if view.kind === 'available'}
			<p>A newer version is ready.{view.latest ? ' ' + view.latest : ''}</p>
			<p class="sub">Your runs are backed up first, and if it doesn’t start the old one comes back.</p>
			<button class="btn pri" type="button" disabled={!!view.blocked} onclick={() => act(() => c?.update())}
				>Update now</button
			>
			{#if view.blocked}<p class="sub" data-testid="blocked">{view.blocked}</p>{/if}
		{:else if view.kind === 'updating'}
			<p>Updating. This takes a minute.</p>
			{#if view.reconnecting}<p class="sub">Pixelsort is restarting. This page will carry on by itself.</p>{/if}
			{#if view.slow}<p class="sub">This is taking longer than expected.</p>{/if}
		{:else if view.kind === 'done'}
			<p>Updated to {view.version}. Reloading.</p>
		{:else if view.kind === 'failed'}
			<p>The update didn’t work.</p>
			<p class="sub">
				{view.rollbackFailed
					? 'Pixelsort may not be running properly. Check the server.'
					: 'The previous version is running again.'}
				{view.detail}
			</p>
			{#if !view.rollbackFailed}<button class="btn" type="button" onclick={() => act(() => c?.check())}
					>Try again</button
				>{/if}
		{/if}
	</div>
	{#if error}<p role="alert" class="err">{error}</p>{/if}
</section>

<style>
	.card {
		padding: 22px 24px;
		display: grid;
		gap: 10px;
		justify-items: start;
	}
	code {
		font-family: var(--mono);
	}
	.err {
		color: var(--ver);
	}
</style>
