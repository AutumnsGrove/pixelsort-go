<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Star, Trash2, RotateCcw } from '@lucide/svelte';
	import TopBar from '#components/TopBar';
	import { ServerBackend, type ApiRun, type Usage } from '#lib/api';
	import { agoText, ageInDays, filter, groupLabel, type RunItem } from '#lib/runs-data';
	import { status, usage as usageLevel } from '#lib/states';
	import { suggest } from '#lib/naming';

	const api = new ServerBackend();
	let tab = $state<'all' | 'starred' | 'trash'>('all');
	let q = $state('');
	let runs = $state<ApiRun[]>([]);
	let usage = $state<Usage | null>(null);
	let loaded = $state(false);
	let offline = $state(false);
	let confirmEmpty = $state(false);

	async function load(): Promise<void> {
		try {
			runs = await api.allRuns({ trashed: tab === 'trash' ? '1' : '0' });
			usage = await api.usage();
			offline = false;
		} catch {
			offline = true;
		}
		loaded = true;
	}
	onMount(load);
	$effect(() => {
		void tab;
		void load();
	});

	const now = new Date();
	const nameOf = (r: ApiRun) => r.title ?? suggest(r.settings as { mode?: string }, r.seed);
	const items = $derived<RunItem[]>(
		runs.map((r) => ({
			id: r.id,
			name: nameOf(r),
			p: r.settings as RunItem['p'],
			age: ageInDays(r.created_at, now),
			starred: r.starred,
			bytes: r.result.bytes
		}))
	);
	const shown = $derived(filter(items, { q, starred: tab === 'starred' }));
	const groups = $derived.by(() => {
		const out: { label: string; items: RunItem[] }[] = [];
		for (const it of shown) {
			const label = groupLabel(it.age, now);
			if (out.at(-1)?.label !== label) out.push({ label, items: [] });
			out.at(-1)!.items.push(it);
		}
		return out;
	});
	const thumb = (id: number) => api.imageUrl(runs.find((r) => r.id === id)?.thumb.sha256 ?? '');

	async function star(it: RunItem): Promise<void> {
		await api.patchRun(it.id, { starred: !it.starred });
		await load();
	}
	async function trash(it: RunItem): Promise<void> {
		await api.trash([it.id], true);
		await load();
	}
	async function restore(it: RunItem): Promise<void> {
		await api.restore([it.id]);
		await load();
	}
	async function empty(): Promise<void> {
		await api.emptyTrash();
		confirmEmpty = false;
		await load();
	}
	const gb = (b: number) => b / 2 ** 30; // the budget is configured in GiB
	const banner = $derived(
		usage || offline
			? status(
					{ used: usage ? gb(usage.used_bytes) : 0, budget: usage ? gb(usage.budget_bytes) : 50, offline },
					{ surface: 'archive' }
				)
			: null
	);
	const level = $derived(usage ? usageLevel(gb(usage.used_bytes), gb(usage.budget_bytes)).level : null);
</script>

<svelte:head><title>Archive · pixelsort-go</title></svelte:head>
<TopBar />
<main class="page">
	<h1 class="display">Archive</h1>
	{#if banner}
		<div class="glass banner {banner.kind}" role="status">
			<b>{banner.text}</b> <span>{banner.sub}</span><button class="btn sm" type="button" onclick={load}
				>{banner.action === 'Retry' ? 'Retry' : 'OK'}</button
			>
		</div>
	{/if}
	<div class="bar">
		<div class="chips" role="tablist">
			{#each ['all', 'starred', 'trash'] as t (t)}<button
					type="button"
					role="tab"
					aria-selected={tab === t}
					class:on={tab === t}
					onclick={() => (tab = t as typeof tab)}>{t}</button
				>{/each}
		</div>
		<input
			class="field search"
			type="search"
			placeholder="Search names and recipes"
			bind:value={q}
			aria-label="Search"
		/>
		{#if usage}<span class="eyebrow" data-testid="usage"
				>{gb(usage.used_bytes).toFixed(2)} of {gb(usage.budget_bytes).toFixed(0)} GB{level && level !== 'ok'
					? ' · ' + level
					: ''}</span
			>{/if}
		{#if tab === 'trash' && runs.length}
			{#if confirmEmpty}<button class="btn danger sm" type="button" onclick={empty} data-testid="empty-yes"
					>Delete forever</button
				>{:else}<button class="btn danger sm" type="button" onclick={() => (confirmEmpty = true)}>Empty bin</button
				>{/if}
		{/if}
	</div>

	{#if loaded && shown.length === 0}
		<div class="empty" data-testid="empty">
			<h3 class="display">
				{tab === 'starred'
					? 'No stars yet.'
					: tab === 'trash'
						? 'The bin is empty.'
						: q
							? 'Nothing matches.'
							: 'Nothing sorted yet.'}
			</h3>
			{#if tab === 'all' && !q}<a class="btn pri" href={resolve('/studio')}>Open Studio</a>{/if}
		</div>
	{/if}

	{#each groups as g (g.label)}
		<h2 class="eyebrow gh">{g.label}</h2>
		<div class="grid">
			{#each g.items as it (it.id)}
				<figure class="card" data-testid="run">
					<div class="acts">
						{#if tab === 'trash'}
							<button class="round" type="button" onclick={() => restore(it)} aria-label="Restore {it.name}"
								><RotateCcw size={16} /></button
							>
						{:else}
							<button
								class="round"
								class:starred={it.starred}
								type="button"
								onclick={() => star(it)}
								aria-label="{it.starred ? 'Unstar' : 'Star'} {it.name}"><Star size={16} /></button
							>
							<button class="round" type="button" onclick={() => trash(it)} aria-label="Move {it.name} to the bin"
								><Trash2 size={16} /></button
							>
						{/if}
					</div>
					<img src={thumb(it.id)} alt={it.name} loading="lazy" />
					<figcaption><b>{it.name}</b><small>{agoText(it.age)}</small></figcaption>
				</figure>
			{/each}
		</div>
	{/each}
</main>

<style>
	.page {
		position: relative;
		z-index: 5;
		max-width: 1200px;
		margin: 0 auto;
		padding: 110px 28px 80px;
		display: grid;
		gap: 16px;
	}
	h1 {
		font-size: 56px;
	}
	.banner {
		padding: 12px 18px;
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 11.5px;
	}
	.banner.full {
		border-color: rgba(255, 90, 54, 0.5);
	}
	.bar {
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
	}
	.search {
		max-width: 260px;
	}
	.empty {
		padding: 60px 0;
		display: grid;
		gap: 18px;
		justify-items: start;
	}
	.empty h3 {
		font-size: 44px;
	}
	.gh {
		margin-top: 10px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 14px;
	}
	.card {
		position: relative;
		border: 1px solid var(--faint);
		border-radius: 16px;
		overflow: hidden;
		background: var(--ink2);
	}
	.card img {
		display: block;
		width: 100%;
		aspect-ratio: 8/5;
		object-fit: cover;
	}
	figcaption {
		padding: 10px 12px;
		display: grid;
		gap: 2px;
		font-size: 11px;
	}
	figcaption b {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 16px;
	}
	figcaption small {
		color: var(--dim);
	}
	.acts {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.card:hover .acts,
	.card:focus-within .acts {
		opacity: 1;
	}
	.acts .round {
		background: rgba(10, 9, 8, 0.7);
		min-width: 44px;
		min-height: 44px;
	}
	.starred {
		color: var(--gold);
	}
	@media (hover: none) {
		.acts {
			opacity: 1;
		}
	}
</style>
