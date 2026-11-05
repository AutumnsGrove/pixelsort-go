<script lang="ts">
	import { onMount } from 'svelte';
	import { ServerBackend, type ApiRun } from '#lib/api';
	import { ageInDays, filter, rows, type RunItem, type Row } from '#lib/runs-data';
	import { range, layout } from '#lib/virtual-list';
	import { suggest } from '#lib/naming';

	let { onopen }: { onopen: (run: ApiRun) => void } = $props();
	const api = new ServerBackend();
	const ROW = 64;
	const HEAD = 28;

	let runs = $state<ApiRun[]>([]);
	let q = $state('');
	let loaded = $state(false);
	let offline = $state(false);
	let scrollTop = $state(0);
	let viewH = $state(400);
	let box: HTMLDivElement | undefined = $state();

	onMount(async () => {
		try {
			runs = await api.allRuns({ trashed: '0' });
		} catch {
			offline = true;
		}
		loaded = true;
	});

	const now = new Date();
	const items = $derived<RunItem[]>(
		runs.map((r) => ({
			id: r.id,
			name: r.title ?? suggest(r.settings as { mode?: string }, r.seed),
			p: r.settings as RunItem['p'],
			age: ageInDays(r.created_at, now),
			starred: r.starred
		}))
	);
	const model = $derived(rows(filter(items, { q }), { cols: 1, headH: HEAD, rowH: ROW, now }));
	const off = $derived(layout(model.rows));
	const win = $derived(range(off, scrollTop, viewH, 200));
	const visible = $derived(model.rows.slice(win[0], win[1]).map((r, i) => ({ r, top: off[win[0] + i] ?? 0 })));
	const total = $derived(off[off.length - 1] ?? 0);
	const byId = (id: number) => runs.find((r) => r.id === id);

	/** A far jump is instant; smooth scrolling misbehaves on long virtual lists. */
	function jump(row: number): void {
		if (box) box.scrollTo({ top: off[row] ?? 0, behavior: 'instant' });
	}
	function open(it: RunItem): void {
		const r = byId(it.id);
		if (r) onopen(r);
	}
</script>

<aside class="strip glass" aria-label="Past runs" data-testid="strip">
	<input class="field" type="search" placeholder="Search runs" bind:value={q} aria-label="Search runs" />
	<div class="body">
		<div
			class="scroll"
			bind:this={box}
			bind:clientHeight={viewH}
			onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
			data-testid="strip-scroll"
		>
			<div class="spacer" style:height="{total}px">
				{#each visible as { r, top } (top)}
					{@const row = r as Row}
					{#if row.type === 'head'}
						<h4 class="eyebrow head" style:top="{top}px" style:height="{row.h}px">{row.label}</h4>
					{:else}
						{#each row.items as it (it.id)}
							<button
								type="button"
								class="run"
								style:top="{top}px"
								style:height="{row.h - 4}px"
								onclick={() => open(it)}
								data-testid="strip-run"
							>
								<img src={api.imageUrl(byId(it.id)?.thumb.sha256 ?? '')} alt="" loading="lazy" />
								<span>{it.name}</span>
							</button>
						{/each}
					{/if}
				{/each}
			</div>
		</div>
		{#if model.jumps.length > 1}
			<nav class="rail" aria-label="Jump to a date">
				{#each model.jumps as j (j.label)}
					<button type="button" onclick={() => jump(j.row)} title={j.label}>{j.label.slice(0, 3)}</button>
				{/each}
			</nav>
		{/if}
	</div>
	{#if loaded && items.length === 0}<p class="none">
			{offline ? 'Runs are not available right now.' : 'No runs yet.'}
		</p>{/if}
</aside>

<style>
	.strip {
		position: fixed;
		left: 14px;
		top: 70px;
		bottom: 120px;
		width: 230px;
		z-index: 60;
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 8px;
		padding: 10px;
	}
	.body {
		display: flex;
		min-height: 0;
		gap: 4px;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		position: relative;
	}
	.spacer {
		position: relative;
	}
	.head,
	.run {
		position: absolute;
		left: 0;
		right: 0;
	}
	.head {
		margin: 0;
		display: flex;
		align-items: flex-end;
	}
	.run {
		display: flex;
		gap: 8px;
		align-items: center;
		text-align: left;
		border-radius: 10px;
		padding: 4px;
		font-size: 11px;
	}
	.run:hover,
	.run:focus-visible {
		background: rgba(255, 255, 255, 0.07);
	}
	.run img {
		width: 56px;
		height: 38px;
		object-fit: cover;
		border-radius: 6px;
	}
	.run span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rail {
		display: flex;
		flex-direction: column;
		font-size: 9px;
		overflow-y: auto;
	}
	.none {
		color: var(--dim);
		font-size: 11px;
		margin: 0;
	}
	@media (max-width: 700px) {
		.strip {
			display: none;
		}
	}
</style>
