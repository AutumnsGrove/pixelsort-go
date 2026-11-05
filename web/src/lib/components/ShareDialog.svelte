<script lang="ts">
	import { ServerBackend, type ApiRun } from '#lib/api';
	import { describe } from '#lib/errors';
	import { settings } from '#lib/settings.svelte';
	import { expiryDays, ShareBackend, stripMetadata, type Created } from '#lib/share';

	let {
		run,
		name,
		onclose,
		onshared
	}: { run: ApiRun; name: string; onclose: () => void; onshared?: (c: Created) => void } = $props();

	const share = new ShareBackend();
	const api = new ServerBackend();

	let includeRecipe = $state(false);
	let includeOriginal = $state(false); // off unless asked for
	let expiry = $state<'never' | '30'>(settings.shareExpiry);
	let busy = $state(false);
	let failed = $state(false);
	let created = $state<Created | null>(null);
	let copied = $state(false);
	const failure = describe('share-failed');

	async function create(): Promise<void> {
		busy = true;
		failed = false;
		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain request payload, not reactive state
			const originals = new Map<number, Blob>();
			if (includeOriginal) {
				// the browser re-encodes the original, which drops EXIF and GPS; the server never sends a stored original as is
				const res = await fetch(api.imageUrl(run.original.sha256));
				originals.set(run.id, await stripMetadata(await res.blob()));
			}
			created = await share.create(
				{ runIds: [run.id], includeRecipe, includeOriginal, expiresInDays: expiryDays(expiry), title: name },
				originals
			);
			onshared?.(created);
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}
	async function copy(): Promise<void> {
		if (!created) return;
		await navigator.clipboard.writeText(created.url).then(
			() => (copied = true),
			() => (copied = false)
		);
	}
</script>

<div class="er" role="dialog" aria-modal="true" aria-label="Share" data-testid="share-dialog">
	<div class="er-card glass">
		<div class="eyebrow">Share</div>
		<h3>{name}</h3>
		{#if created}
			<p>Your link is ready.</p>
			<input class="field" readonly value={created.url} aria-label="Share link" data-testid="share-url" />
			<div class="foot">
				<button class="btn" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
				<button class="btn pri" type="button" onclick={onclose}>Done</button>
			</div>
		{:else}
			<p class="warn">Anyone with the link can see this. It is unlisted, not private.</p>
			<label class="row"><input type="checkbox" checked disabled /> The picture</label>
			<label class="row"><input type="checkbox" bind:checked={includeRecipe} /> The recipe (the settings)</label>
			<label class="row"
				><input type="checkbox" bind:checked={includeOriginal} /> The original too (location and camera data are removed)</label
			>
			<div class="chips" role="radiogroup" aria-label="Expiry">
				<button
					type="button"
					role="radio"
					aria-checked={expiry === 'never'}
					class:on={expiry === 'never'}
					onclick={() => (expiry = 'never')}>Never expires</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={expiry === '30'}
					class:on={expiry === '30'}
					onclick={() => (expiry = '30')}>Expires in 30 days</button
				>
			</div>
			{#if failed}
				<div role="alert" class="fail" data-testid="share-error">
					<b>{failure.title}</b>
					<span>{failure.body} {failure.safe}</span>
				</div>
			{/if}
			<div class="foot">
				<button class="btn" type="button" onclick={onclose}>Cancel</button>
				<button class="btn pri" type="button" disabled={busy} onclick={create}
					>{busy ? 'Making the link…' : 'Create link'}</button
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.er {
		position: fixed;
		inset: 0;
		z-index: 150;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgba(8, 7, 6, 0.8);
		backdrop-filter: blur(10px);
	}
	.er-card {
		width: min(520px, 100%);
		padding: 26px 28px 22px;
		display: grid;
		gap: 12px;
	}
	h3 {
		font-size: 32px;
		line-height: 1.05;
	}
	p {
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.7;
	}
	.warn {
		color: var(--paper);
		padding-left: 12px;
		border-left: 2px solid var(--gold);
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
	}
	.chips {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.fail {
		display: grid;
		gap: 4px;
		font-size: 11.5px;
		padding-left: 12px;
		border-left: 2px solid var(--ver);
	}
	.foot {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		margin-top: 6px;
	}
</style>
