<script lang="ts">
	import { onMount } from 'svelte';
	import { X, Trash2 } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';
	import { PATTERNS, SHAPES, classCount } from '#lib/regions';
	import { MAX_RADIUS, MIN_RADIUS } from '#lib/brush';
	import RegionCard from '#components/RegionCard';
	import ShapeLibrary from '#components/ShapeLibrary';

	let { onclose }: { onclose: () => void } = $props();

	// On a phone the panel is a bottom sheet with two tabs, so the picture stays in view; elsewhere it shows everything.
	let phone = $state(false);
	let tab = $state<'shapes' | 'protect'>('shapes');
	const showShapes = $derived(!phone || tab === 'shapes');
	const showProtect = $derived(!phone || tab === 'protect');
	onMount(() => {
		const mq = matchMedia('(max-width: 600px)');
		phone = mq.matches;
		const on = () => (phone = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	let hist = $state<number[]>([]);
	let caList = $state<{ rule: number; note: string }[]>([]);
	const peak = $derived(Math.max(1, ...hist));
	$effect(() => {
		// the histogram follows the picture and the key; it is asked of the engine, which owns the key maths
		void studio.size;
		void studio.params.thresholdKey;
		if (studio.params.mode === 'threshold') void studio.histogram().then((h) => (hist = h));
	});
	$effect(() => {
		if ((studio.params.mode === 'ca' || studio.params.mode === 'ca-edges') && caList.length === 0)
			void studio.caRules().then((r) => (caList = r));
	});

	const t = $derived(studio.tiling);
	const nClasses = $derived(t ? classCount(t.pattern, t.kinds) : 0);

	function edit(patch: Partial<NonNullable<typeof t>>): void {
		if (!studio.tiling) return;
		Object.assign(studio.tiling, patch);
		void studio.applyRegions();
	}
	/** How many shapes each kind has, read off the engine's per-cell class map: one count per kind. */
	const shapeCounts = $derived(studio.kindCounts());
</script>

<aside class="pro glass" aria-label="Pro panel" data-testid="pro">
	<header>
		<div>
			<div class="eyebrow">Pro</div>
			<h3>Regions &amp; protect</h3>
		</div>
		<button class="round" type="button" onclick={onclose} aria-label="Close the Pro panel"><X size={17} /></button>
	</header>

	{#if phone}
		<div class="tabs" role="tablist" aria-label="Pro panel sections">
			{#each [['shapes', 'Shapes'], ['protect', 'Protect']] as [id, label] (id)}
				<button
					type="button"
					role="tab"
					class:on={tab === id}
					aria-selected={tab === id}
					onclick={() => (tab = id as typeof tab)}
					data-testid="tab-{id}">{label}</button
				>
			{/each}
		</div>
	{/if}

	{#if showShapes && studio.params.mode === 'threshold'}
		<section data-testid="histogram-section">
			<h4 class="eyebrow">Threshold band</h4>
			<svg
				class="hist"
				viewBox="0 0 256 60"
				preserveAspectRatio="none"
				role="img"
				aria-label="Histogram of the {studio.params.thresholdKey} values"
				data-testid="histogram"
			>
				{#each hist as c, i (i)}<rect x={i} y={60 - (c / peak) * 60} width="1" height={(c / peak) * 60} />{/each}
				<rect
					class="band"
					x={studio.params.lo}
					y="0"
					width={Math.max(0, studio.params.hi - studio.params.lo)}
					height="60"
				/>
			</svg>
			<label
				>from {studio.params.lo}
				<input
					type="range"
					min="0"
					max="255"
					value={studio.params.lo}
					oninput={(e) => {
						studio.params.lo = Math.min(Number(e.currentTarget.value), studio.params.hi);
						studio.changed();
					}}
					aria-label="Band from"
				/></label
			>
			<label
				>to {studio.params.hi}
				<input
					type="range"
					min="0"
					max="255"
					value={studio.params.hi}
					oninput={(e) => {
						studio.params.hi = Math.max(Number(e.currentTarget.value), studio.params.lo);
						studio.changed();
					}}
					aria-label="Band to"
				/></label
			>
		</section>
	{/if}

	{#if showShapes && (studio.params.mode === 'ca' || studio.params.mode === 'ca-edges')}
		<section data-testid="rules-section">
			<h4 class="eyebrow">Cellular rule {studio.params.rule}</h4>
			<ul class="rules">
				{#each caList as r (r.rule)}
					<li>
						<button
							type="button"
							class:on={studio.params.rule === r.rule}
							onclick={() => {
								studio.params.rule = r.rule;
								studio.changed();
							}}
							data-testid="rule-{r.rule}"><b>{r.rule}</b> <span>{r.note}</span></button
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if showShapes}<section>
			<h4 class="eyebrow">Cut the picture into</h4>
			<div class="chips" role="group" aria-label="Shape">
				<button type="button" class:on={!t} onclick={() => studio.setTilingShape(null)} data-testid="shape-none"
					>none</button
				>
				{#each SHAPES as s (s)}<button
						type="button"
						class:on={t?.shape === s}
						onclick={() => studio.setTilingShape(s)}
						data-testid="shape-{s}">{s}</button
					>{/each}
			</div>
			<ShapeLibrary compact={phone} />

			{#if t}
				<label
					>size {t.size}
					<input
						type="range"
						min="20"
						max="400"
						value={t.size}
						oninput={(e) => edit({ size: Number(e.currentTarget.value) })}
						aria-label="Cell size"
					/></label
				>
				<label
					>gap {t.gap}
					<input
						type="range"
						min="0"
						max="60"
						value={t.gap}
						oninput={(e) => edit({ gap: Number(e.currentTarget.value) })}
						aria-label="Gap"
					/></label
				>
				<label
					>turn {t.rotate}°
					<input
						type="range"
						min="0"
						max="359"
						value={t.rotate}
						oninput={(e) => edit({ rotate: Number(e.currentTarget.value) })}
						aria-label="Turn the cells"
					/></label
				>
				<div class="chips" role="group" aria-label="Pattern">
					{#each PATTERNS as p (p)}<button type="button" class:on={t.pattern === p} onclick={() => edit({ pattern: p })}
							>{p}</button
						>{/each}
				</div>
				{#if t.pattern === 'random'}<label
						>kinds {t.kinds}
						<input
							type="range"
							min="1"
							max="8"
							value={t.kinds}
							oninput={(e) => edit({ kinds: Number(e.currentTarget.value) })}
							aria-label="Kinds"
						/></label
					>{/if}
				<label class="tog"
					><span><b>Show the cells</b></span><input type="checkbox" bind:checked={studio.showCells} /></label
				>

				<div class="cards">
					{#each Array.from({ length: nClasses }, (_, i) => i + 1) as c (c)}
						{#if studio.cards[c]}
							<RegionCard
								card={studio.cards[c]}
								kind={c}
								title={studio.cards[c].name}
								count={shapeCounts[c] ?? 0}
								width={studio.size?.w ?? 1000}
								compact={phone}
								onchange={() => void studio.applyRegions()}
							/>
						{/if}
					{/each}
				</div>
			{/if}
		</section>{/if}

	{#if showProtect}<section>
			<h4 class="eyebrow">Protect from sorting</h4>
			<div class="chips" role="group" aria-label="Tool">
				{#each [['move', 'Move shapes'], ['paint', 'Paint'], ['erase', 'Erase']] as [id, label] (id)}
					<button
						type="button"
						class:on={studio.tool === id}
						aria-pressed={studio.tool === id}
						onclick={() => (studio.tool = id as typeof studio.tool)}
						data-testid="tool-{id}">{label}</button
					>
				{/each}
			</div>
			{#if studio.tool !== 'move'}
				<label
					>Brush size {Math.max(1, Math.round(studio.brushRadius * 2 * (studio.size?.w ?? 1000)))} px
					<input
						type="range"
						min={MIN_RADIUS}
						max={MAX_RADIUS}
						step="0.001"
						bind:value={studio.brushRadius}
						aria-label="Brush size"
						data-testid="brush-size"
					/></label
				>
			{/if}
			{#if studio.suggestion}
				<div class="snap" role="status" data-testid="snap">
					<span>Looks like a {studio.suggestion.guess.label}.</span>
					<button type="button" class="mini" onclick={() => studio.snapSuggestion()} data-testid="snap-accept"
						>Snap</button
					>
					<button type="button" class="mini" onclick={() => (studio.suggestion = null)}>Keep my stroke</button>
				</div>
			{/if}
			{#if studio.maskStrokes.length}
				<div class="obj" data-testid="strokes">
					<b>{studio.maskStrokes.length} brush {studio.maskStrokes.length === 1 ? 'stroke' : 'strokes'}</b>
					<button type="button" class="mini" onclick={() => studio.clearStrokes()} data-testid="clear-strokes"
						>clear strokes</button
					>
				</div>
			{/if}
			<div class="chips">
				<button type="button" onclick={() => studio.addMaskObject('ellipse')} data-testid="add-ellipse"
					>+ ellipse</button
				>
				<button type="button" onclick={() => studio.addMaskObject('rect')}>+ rectangle</button>
				<button type="button" onclick={() => studio.protectBrightestSpot()} data-testid="brightest"
					>brightest spot</button
				>
			</div>
			{#each studio.maskObjects as o, i (i)}
				<div class="obj" data-testid="mask-object">
					<b>{o.kind}</b>
					<button
						type="button"
						class="mini"
						onclick={() => {
							o.mode = o.mode === 'add' ? 'cut' : 'add';
							void studio.applyMask();
						}}>{o.mode === 'add' ? 'protects' : 'punches a hole'}</button
					>
					<label
						>x <input
							type="range"
							min="0"
							max="1"
							step="0.01"
							bind:value={o.cx}
							oninput={() => studio.applyMask()}
							aria-label="Horizontal position"
						/></label
					>
					<label
						>y <input
							type="range"
							min="0"
							max="1"
							step="0.01"
							bind:value={o.cy}
							oninput={() => studio.applyMask()}
							aria-label="Vertical position"
						/></label
					>
					<label
						>size <input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							bind:value={o.w}
							oninput={() => {
								o.h = o.w * ((studio.size?.w ?? 1) / (studio.size?.h ?? 1));
								void studio.applyMask();
							}}
							aria-label="Size"
						/></label
					>
					<button
						class="round"
						type="button"
						onclick={() => {
							studio.maskObjects.splice(i, 1);
							void studio.applyMask();
						}}
						aria-label="Remove {o.kind}"><Trash2 size={15} /></button
					>
				</div>
			{/each}
			<label class="tog"
				><span><b>Invert</b><small>Sort only inside the protected shapes.</small></span><input
					type="checkbox"
					bind:checked={studio.maskInvert}
					onchange={() => studio.applyMask()}
				/></label
			>
			<label
				>soft edge {Math.round(studio.maskFeather * 100)}%
				<input
					type="range"
					min="0"
					max="0.2"
					step="0.01"
					bind:value={studio.maskFeather}
					oninput={() => studio.applyMask()}
					aria-label="Soft edge"
				/></label
			>
		</section>{/if}
</aside>

<style>
	.hist {
		width: 100%;
		height: 60px;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 6px;
	}
	.hist rect {
		fill: var(--dim);
	}
	.hist .band {
		fill: var(--ver);
		opacity: 0.25;
	}
	.rules {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.rules button {
		display: flex;
		gap: 10px;
		width: 100%;
		text-align: left;
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 11px;
	}
	.rules button.on {
		background: rgba(255, 90, 54, 0.18);
	}
	.rules span {
		color: var(--dim);
	}
	.pro {
		position: fixed;
		right: 14px;
		top: 76px;
		bottom: 120px;
		width: min(380px, calc(100vw - 28px));
		z-index: 45;
		overflow: auto;
		padding: 18px 20px;
		display: grid;
		gap: 18px;
		align-content: start;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: start;
	}
	h3 {
		font-size: 26px;
	}
	section {
		display: grid;
		gap: 10px;
	}
	label {
		display: grid;
		gap: 2px;
		font-size: 11px;
		color: var(--dim);
	}
	.cards {
		display: grid;
		gap: 8px;
	}
	.obj {
		display: grid;
		gap: 4px;
		padding: 8px 10px;
		border: 1px solid var(--faint);
		border-radius: 12px;
	}
	.mini {
		justify-self: start;
		font-size: 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
		border: 1px solid var(--faint);
		border-radius: 99px;
		padding: 4px 10px;
	}
	.tog {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.snap {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--faint);
		border-radius: 12px;
		font-size: 11px;
	}
	.tabs {
		display: flex;
		gap: 6px;
	}
	.tabs button {
		flex: 1;
		min-height: 44px;
		border: 1px solid var(--faint);
		border-radius: 99px;
		font-size: 12px;
		letter-spacing: 0.6px;
		color: var(--dim);
	}
	.tabs button.on {
		background: var(--paper);
		color: var(--ink);
		border-color: var(--paper);
	}
	/* Phone: a bottom sheet above the dock, so the picture stays in view; every target is at least 44 px. */
	@media (max-width: 600px) {
		.pro {
			top: auto;
			bottom: 104px;
			left: 10px;
			right: 10px;
			width: auto;
			max-height: 46vh;
			padding: 12px 14px;
			gap: 12px;
			border-radius: 20px;
		}
		h3 {
			font-size: 20px;
		}
		.pro :global(button),
		.pro :global(select),
		.pro :global(input[type='number']),
		.pro :global(input[type='range']),
		.pro :global(summary) {
			min-height: 44px;
		}
		.pro :global(button.round) {
			min-width: 44px;
		}
	}
</style>
