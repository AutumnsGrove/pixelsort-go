<script lang="ts">
	import { onMount } from 'svelte';
	import { ShareBackend, type ShareRow } from '#lib/share';

	let { onchange }: { onchange?: () => void } = $props();
	const share = new ShareBackend();

	let rows = $state<ShareRow[]>([]);
	let loaded = $state(false);
	let error = $state('');
	let confirming = $state<string | null>(null);

	async function load(): Promise<void> {
		try {
			rows = await share.list();
			error = '';
		} catch {
			error = 'Couldn’t load your shared links.';
		}
		loaded = true;
	}
	onMount(load);

	async function revoke(id: string): Promise<void> {
		try {
			await share.revoke(id);
			confirming = null;
			await load();
			onchange?.();
		} catch {
			error = 'The link could not be turned off. It is still live. Try again in a moment.';
		}
	}
	const when = (t: number | null) => (t ? new Date(t * 1000).toLocaleDateString() : '');
	const status = (r: ShareRow) =>
		r.revoked_at
			? 'Revoked'
			: r.expires_at && r.expires_at * 1000 < Date.now()
				? 'Expired'
				: r.expires_at
					? `Expires ${when(r.expires_at)}`
					: 'Never expires';
</script>

<section aria-label="Shared links" data-testid="albums">
	{#if error}<p role="alert" class="err">{error}</p>{/if}
	{#if loaded && rows.length === 0 && !error}
		<p class="empty" data-testid="albums-empty">Nothing shared yet. Use Share on any picture to make a link.</p>
	{/if}
	<ul>
		{#each rows as r (r.id)}
			<li class="glass" class:gone={!!r.revoked_at} data-testid="share-row">
				<div>
					<b class:struck={!!r.revoked_at}>{r.title || 'Shared pictures'}</b>
					<small
						>{r.items}
						{r.items === 1 ? 'picture' : 'pictures'} · {status(r)}{r.include_recipe
							? ' · recipe'
							: ''}{r.include_original ? ' · original' : ''}</small
					>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external share link -->
					{#if !r.revoked_at}<a href={r.url} target="_blank" rel="noopener noreferrer" class="link">{r.url}</a>{/if}
				</div>
				{#if !r.revoked_at}
					{#if confirming === r.id}
						<button class="btn danger sm" type="button" onclick={() => revoke(r.id)} data-testid="revoke-yes"
							>Turn the link off</button
						>
						<button class="btn sm" type="button" onclick={() => (confirming = null)}>Keep it</button>
					{:else}
						<button class="btn sm" type="button" onclick={() => (confirming = r.id)}>Revoke</button>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 10px;
	}
	li {
		padding: 14px 18px;
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	li > div {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	small,
	.link {
		color: var(--dim);
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.gone {
		opacity: 0.6;
	}
	.struck {
		text-decoration: line-through;
	}
	.err {
		color: var(--ver);
	}
	.empty {
		color: var(--dim);
		padding: 30px 0;
	}
</style>
