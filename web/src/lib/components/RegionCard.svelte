<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { classColor } from '#lib/overlay';
	import {
		ALGO_LABEL,
		CARD_ALGOS,
		CARD_KEYS,
		CARD_MODES,
		MODE_LABEL,
		RULE_PICKS,
		cardSummary,
		clampCard,
		type RegionCard
	} from '#lib/region-cards';

	// One card per kind of cell: Studio's Pro panel and the phone's Shapes sheet both use this, so they cannot drift apart.
	// `compact` is the phone layout (44 px targets). Anything left unset inherits the global recipe.
	let {
		card,
		kind,
		title,
		count,
		width = 1000,
		compact = false,
		onchange
	}: {
		card: RegionCard;
		kind: number;
		title: string;
		count: number;
		/** The picture's width in working pixels, to show per-mille lengths as pixels. */
		width?: number;
		compact?: boolean;
		onchange: () => void;
	} = $props();

	const px = (permille: number) => Math.max(1, Math.round((permille * width) / 1000));
	const id = $derived(`rc-${kind}`);

	/** Apply a change, tidy the numbers into range, and tell the owner. */
	function set(patch: Partial<RegionCard>): void {
		Object.assign(card, clampCard({ ...card, ...patch }), { open: card.open });
		onchange();
	}
	const field = (e: Event) => (e.currentTarget as HTMLInputElement).value;
</script>

<div class="card" class:compact data-testid="class-{kind}">
	<button
		type="button"
		class="head"
		aria-expanded={card.open}
		aria-controls="{id}-body"
		onclick={() => (card.open = !card.open)}
		data-testid="class-{kind}-head"
	>
		<i style:background="rgb({classColor(kind).join(',')})"></i>
		<span class="title"><b>{title}</b><small data-testid="class-{kind}-summary">{cardSummary(card)}</small></span>
		<span class="count">{count} {count === 1 ? 'shape' : 'shapes'}</span>
		<ChevronDown size={15} class="chev" />
	</button>

	{#if card.open}
		<div class="body" id="{id}-body">
			<label class="row">
				<span>Frozen — don’t sort</span>
				<input
					type="checkbox"
					role="switch"
					checked={card.frozen}
					onchange={(e) => set({ frozen: e.currentTarget.checked })}
					aria-label="Freeze kind {kind}"
				/>
			</label>

			<div class="row">
				<label for="{id}-angle-on">Own direction</label>
				<span class="ctl">
					<input
						type="number"
						class="field num"
						min="0"
						max="359"
						value={card.angle}
						disabled={!card.angleOn}
						oninput={(e) => set({ angle: Number(field(e)) })}
						aria-label="Direction for kind {kind}"
					/>
					<input
						id="{id}-angle-on"
						type="checkbox"
						role="switch"
						checked={card.angleOn}
						onchange={(e) => set({ angleOn: e.currentTarget.checked })}
					/>
				</span>
			</div>

			<div class="row">
				<label for="{id}-key">Own sort key</label>
				<select
					id="{id}-key"
					class="field"
					value={card.key}
					onchange={(e) => set({ key: field(e) as RegionCard['key'] })}
					aria-label="Sort key for kind {kind}"
				>
					<option value="">same as global</option>
					{#each CARD_KEYS as k (k)}<option>{k}</option>{/each}
				</select>
			</div>
			<div class="chips" role="group" aria-label="Sort order for kind {kind}">
				{#each [['', 'either way'], ['asc', '↑ ascending'], ['desc', '↓ descending']] as [v, label] (v)}
					<button
						type="button"
						class:on={card.order === v}
						aria-pressed={card.order === v}
						onclick={() => set({ order: v as RegionCard['order'] })}>{label}</button
					>
				{/each}
			</div>

			<div class="sub">Watch this kind as</div>
			<div class="chips" role="group" aria-label="Animation for kind {kind}">
				{#each CARD_ALGOS as a (a)}
					<button
						type="button"
						class:on={card.algo === a}
						aria-pressed={card.algo === a}
						onclick={() => set({ algo: a })}>{a ? ALGO_LABEL[a] : 'same as global'}</button
					>
				{/each}
			</div>

			<label class="row">
				<span>Own cutting</span>
				<input
					type="checkbox"
					role="switch"
					checked={card.cutOn}
					onchange={(e) => set({ cutOn: e.currentTarget.checked })}
					aria-label="Own cutting for kind {kind}"
				/>
			</label>
			{#if card.cutOn}
				<div class="cut" data-testid="class-{kind}-cut">
					<div class="chips" role="group" aria-label="Cutting mode for kind {kind}">
						{#each CARD_MODES as m (m)}
							<button
								type="button"
								class:on={card.mode === m}
								aria-pressed={card.mode === m}
								onclick={() => set({ mode: m })}>{MODE_LABEL[m]}</button
							>
						{/each}
					</div>
					{#if card.mode === 'random' || card.mode === 'wave'}
						<label
							>Run length <em>{px(card.length)} px</em>
							<input
								type="range"
								min="1"
								max="300"
								value={card.length}
								oninput={(e) => set({ length: Number(field(e)) })}
								aria-label="Run length for kind {kind}"
							/></label
						>
					{/if}
					{#if card.mode === 'threshold'}
						<label
							>Sort from <em>{card.lo}</em>
							<input
								type="range"
								min="0"
								max="255"
								value={card.lo}
								oninput={(e) => set({ lo: Number(field(e)) })}
								aria-label="Sort from for kind {kind}"
							/></label
						>
						<label
							>Sort up to <em>{card.hi}</em>
							<input
								type="range"
								min="0"
								max="255"
								value={card.hi}
								oninput={(e) => set({ hi: Number(field(e)) })}
								aria-label="Sort up to for kind {kind}"
							/></label
						>
					{/if}
					{#if card.mode === 'edges'}
						<label
							>Edge sensitivity <em>{card.edge}</em>
							<input
								type="range"
								min="6"
								max="90"
								value={card.edge}
								oninput={(e) => set({ edge: Number(field(e)) })}
								aria-label="Edge sensitivity for kind {kind}"
							/></label
						>
					{/if}
					{#if card.mode === 'ca'}
						<div class="row">
							<label for="{id}-rule">Rule</label>
							<input
								id="{id}-rule"
								type="number"
								class="field num"
								min="0"
								max="255"
								value={card.rule}
								oninput={(e) => set({ rule: Number(field(e)) })}
							/>
						</div>
						<div class="chips" role="group" aria-label="Rule for kind {kind}">
							{#each RULE_PICKS as r (r)}
								<button
									type="button"
									class:on={card.rule === r}
									aria-pressed={card.rule === r}
									onclick={() => set({ rule: r })}>{r}</button
								>
							{/each}
						</div>
						<label
							>Cell size <em>{px(card.cell)} px</em>
							<input
								type="range"
								min="2"
								max="60"
								value={card.cell}
								oninput={(e) => set({ cell: Number(field(e)) })}
								aria-label="Cell size for kind {kind}"
							/></label
						>
					{/if}
					{#if card.mode !== 'none'}
						<label
							>Leave unsorted <em>{card.randomness} %</em>
							<input
								type="range"
								min="0"
								max="100"
								value={card.randomness}
								oninput={(e) => set({ randomness: Number(field(e)) })}
								aria-label="Leave unsorted for kind {kind}"
							/></label
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.card {
		border: 1px solid var(--faint);
		border-radius: 14px;
		display: grid;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		text-align: left;
		width: 100%;
		background: none;
		color: inherit;
		border-radius: 14px;
	}
	.compact .head {
		min-height: 44px;
	}
	.head i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.title {
		display: grid;
		min-width: 0;
		flex: 1;
	}
	.title small {
		color: var(--dim);
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		color: var(--dim);
		font-size: 10px;
	}
	.head :global(.chev) {
		transition: transform 0.15s;
	}
	.head[aria-expanded='true'] :global(.chev) {
		transform: rotate(180deg);
	}
	.body {
		display: grid;
		gap: 8px;
		padding: 0 12px 12px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: var(--dim);
	}
	.compact .row {
		min-height: 44px;
	}
	.ctl {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.num {
		width: 70px;
	}
	.sub {
		font-size: 11px;
		color: var(--dim);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.compact .chips button {
		min-height: 44px;
		padding: 0 14px;
	}
	.cut {
		display: grid;
		gap: 8px;
		padding: 10px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.18);
	}
	.cut label {
		display: grid;
		gap: 2px;
		font-size: 11px;
		color: var(--dim);
	}
	.cut em {
		font-style: normal;
		float: right;
	}
</style>
