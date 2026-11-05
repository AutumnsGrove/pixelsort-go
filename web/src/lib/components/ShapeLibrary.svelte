<script lang="ts">
	import { onMount } from 'svelte';
	import { Trash2 } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';
	import { readSvg, starterShape, STARTERS } from '#lib/svg-shapes';
	import { buildShape, needsTidy, ringsPath, type RawShape, type TidyOptions } from '#lib/shape-tidy';

	// The custom-shape library: eleven starters, "your shapes", paste or drop an SVG, and the tidy-up step for files with
	// several pieces, holes or lots of points. SVG text is read as data and discarded (see svg-shapes.ts).
	let { compact = false }: { compact?: boolean } = $props();

	const ICON = 36;
	let starters = $state<{ name: string; d: string; poly: [number, number][]; more: [number, number][][] }[]>([]);
	let text = $state('');
	let error = $state('');
	let raw = $state<RawShape | null>(null);
	let tidy = $state<Required<TidyOptions>>({ pieces: 'largest', holes: true, minHole: 0, simplify: 0 });
	let name = $state('');
	const built = $derived(raw ? buildShape(raw, tidy) : null);
	const t = $derived(studio.tiling);

	onMount(() => {
		starters = STARTERS.map((s, i) => {
			const sh = starterShape(i);
			return { name: s.name, d: ringsPath([sh.poly, ...sh.more], ICON), poly: sh.poly, more: sh.more };
		});
		void studio.loadMyShapes();
	});

	// A file dropped (or text pasted) anywhere in Studio arrives here.
	$effect(() => {
		const pending = studio.pendingSvg;
		if (pending === null) return;
		studio.pendingSvg = null;
		text = pending;
		read();
	});

	function read(): void {
		error = '';
		raw = null;
		const r = readSvg(text);
		if (r.error !== undefined) {
			error = r.error;
			return;
		}
		if (!needsTidy(r.raw)) {
			// a plain shape goes straight in
			const b = buildShape(r.raw);
			void studio.saveShape(name, b.poly, b.more).then(() => (text = ''));
			return;
		}
		raw = r.raw;
		tidy = { pieces: 'largest', holes: true, minHole: 0, simplify: 0 };
	}
	function add(): void {
		if (!built) return;
		void studio.saveShape(name, built.poly, built.more);
		cancel();
	}
	function cancel(): void {
		raw = null;
		text = '';
		name = '';
	}
</script>

<div class="lib" class:compact data-testid="shape-library">
	<div class="chips tiles" role="group" aria-label="Starter shapes">
		{#each starters as s, i (s.name)}
			<button
				type="button"
				class="tile"
				class:on={t?.shape === 'custom' && studio.customKey === `starter-${i}`}
				aria-pressed={t?.shape === 'custom' && studio.customKey === `starter-${i}`}
				aria-label={s.name}
				title={s.name}
				onclick={() => studio.useShape(s.poly, s.more, `starter-${i}`)}
				data-testid="starter-{s.name}"
			>
				<svg viewBox="0 0 {ICON} {ICON}" width={ICON} height={ICON} aria-hidden="true"
					><path d={s.d} fill-rule="evenodd" /></svg
				>
			</button>
		{/each}
	</div>

	{#if studio.myShapes.length}
		<h5 class="eyebrow">Your shapes</h5>
		<div class="chips tiles" role="group" aria-label="Your shapes" data-testid="my-shapes">
			{#each studio.myShapes as s (s.id)}
				<span class="mine">
					<button
						type="button"
						class="tile"
						class:on={t?.shape === 'custom' && studio.customKey === s.id}
						aria-pressed={t?.shape === 'custom' && studio.customKey === s.id}
						aria-label={s.name}
						title={s.name}
						onclick={() => studio.useShape(s.poly, s.more, s.id)}
						data-testid="my-shape"
					>
						<svg viewBox="0 0 {ICON} {ICON}" width={ICON} height={ICON} aria-hidden="true"
							><path d={ringsPath([s.poly, ...s.more], ICON)} fill-rule="evenodd" /></svg
						>
					</button>
					<button type="button" class="x" aria-label="Delete {s.name}" onclick={() => void studio.deleteShape(s)}
						><Trash2 size={11} /></button
					>
				</span>
			{/each}
		</div>
	{/if}

	{#if t?.shape === 'custom'}
		<label class="tog"
			><span>Stagger the rows</span><input
				type="checkbox"
				role="switch"
				checked={!!t.stagger}
				onchange={(e) => studio.setStagger(e.currentTarget.checked)}
				aria-label="Stagger the rows"
			/></label
		>
	{/if}

	<details class="paste" open={!!text || !!error || !!raw}>
		<summary>Add your own from an SVG</summary>
		<p class="hint">
			Drop an .svg file anywhere in Studio, or paste its code here. It becomes a shape, never the picture.
		</p>
		<textarea bind:value={text} rows="3" placeholder="<svg …>" aria-label="SVG code" data-testid="svg-text"></textarea>
		<button type="button" class="mini" onclick={read} disabled={!text.trim()} data-testid="svg-read">Read it</button>
		{#if error}<p class="err" role="alert" data-testid="svg-error">{error}</p>{/if}
	</details>

	{#if raw && built}
		<div class="tidy" data-testid="tidy" role="group" aria-label="Tidy this shape">
			<h5 class="eyebrow">Tidy this shape</h5>
			<svg class="prev" viewBox="0 0 80 80" aria-hidden="true"
				><path d={ringsPath([built.poly, ...built.more], 80)} fill-rule="evenodd" /></svg
			>
			<p class="stats" data-testid="tidy-stats">
				{built.info}{built.stats.droppedRings
					? ` · ${built.stats.droppedRings} ring${built.stats.droppedRings === 1 ? '' : 's'} left out`
					: ''}
			</p>
			{#if raw.pieces.length > 1}
				<div class="chips" role="group" aria-label="Which pieces" data-testid="tidy-pieces">
					<button
						type="button"
						class:on={tidy.pieces === 'largest'}
						aria-pressed={tidy.pieces === 'largest'}
						onclick={() => (tidy.pieces = 'largest')}>just the largest</button
					>
					<button
						type="button"
						class:on={tidy.pieces === 'all'}
						aria-pressed={tidy.pieces === 'all'}
						onclick={() => (tidy.pieces = 'all')}>all of them</button
					>
				</div>
			{/if}
			<label class="tog"
				><span>Keep the holes</span><input
					type="checkbox"
					role="switch"
					bind:checked={tidy.holes}
					aria-label="Keep the holes"
				/></label
			>
			{#if tidy.holes}
				<label
					>Fill holes smaller than {Math.round(tidy.minHole * 100)} %
					<input
						type="range"
						min="0"
						max="0.2"
						step="0.005"
						bind:value={tidy.minHole}
						aria-label="Fill holes smaller than"
					/></label
				>
			{/if}
			<label
				>Simplify {Math.round(tidy.simplify * 100)} %
				<input type="range" min="0" max="0.15" step="0.005" bind:value={tidy.simplify} aria-label="Simplify" /></label
			>
			<input class="field" bind:value={name} placeholder="Name (optional)" aria-label="Shape name" />
			<div class="chips">
				<button type="button" class="on" onclick={add} data-testid="tidy-add">Add</button>
				<button type="button" onclick={cancel} data-testid="tidy-cancel">Cancel</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.lib {
		display: grid;
		gap: 8px;
	}
	.tiles {
		gap: 6px;
	}
	.tile {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 10px;
	}
	.tile svg path {
		fill: rgba(236, 228, 211, 0.16);
		stroke: rgba(236, 228, 211, 0.9);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.tile.on svg path {
		fill: rgba(10, 9, 8, 0.18);
		stroke: var(--ink);
	}
	.mine {
		position: relative;
	}
	.x {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 50%;
		background: var(--ink2);
		border: 1px solid var(--faint);
	}
	.compact .mine {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.compact .x {
		position: static;
		width: 44px;
		height: 44px;
		border-radius: 10px;
	}
	.tog {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 11px;
	}
	.compact .tog {
		min-height: 44px;
	}
	.paste summary {
		cursor: pointer;
		font-size: 11px;
		color: var(--dim);
		min-height: 24px;
	}
	.compact .paste summary {
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.hint {
		font-size: 10px;
		color: var(--dim);
		margin: 4px 0;
	}
	textarea {
		width: 100%;
		font: 11px/1.4 var(--mono, monospace);
		background: rgba(0, 0, 0, 0.25);
		color: inherit;
		border: 1px solid var(--faint);
		border-radius: 8px;
		padding: 6px 8px;
		resize: vertical;
	}
	.mini {
		justify-self: start;
		font-size: 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
		border: 1px solid var(--faint);
		border-radius: 99px;
		padding: 6px 12px;
		margin-top: 6px;
	}
	.compact .mini {
		min-height: 44px;
	}
	.err {
		color: #ff8a70;
		font-size: 11px;
		margin: 4px 0 0;
	}
	.tidy {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--faint);
		border-radius: 14px;
	}
	.tidy label {
		display: grid;
		gap: 2px;
		font-size: 11px;
		color: var(--dim);
	}
	.tidy label.tog {
		display: flex;
	}
	.prev {
		width: 80px;
		height: 80px;
		justify-self: center;
	}
	.prev path {
		fill: rgba(236, 228, 211, 0.16);
		stroke: rgba(236, 228, 211, 0.9);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.stats {
		margin: 0;
		font-size: 11px;
		text-align: center;
	}
</style>
