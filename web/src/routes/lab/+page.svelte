<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { EngineClient } from '#lib/engine/client';
	import { decodeFile, defaultLongEdge, workingSize } from '#lib/engine/image-intake';
	import { defaultParams, keys, modes, type Params } from '#lib/engine/params';
	import type { Stats, Timings } from '#lib/engine/protocol';

	let client: EngineClient | null = null;
	let params = $state<Params>({ ...defaultParams });
	let size = $state<{ w: number; h: number } | null>(null);
	let sourceSize = $state<{ w: number; h: number } | null>(null);
	let stats = $state<Stats | null>(null);
	let timings = $state<Timings | null>(null);
	let error = $state('');
	let isolated = $state(false);
	let busy = $state(false);
	let origCanvas: HTMLCanvasElement | undefined = $state();
	let sortedCanvas: HTMLCanvasElement | undefined = $state();
	let debounce: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		isolated = crossOriginIsolated;
		client = new EngineClient();
		client.transfer = new URLSearchParams(location.search).get('transfer') === 'view' ? 'view' : 'copy';
	});
	onDestroy(() => {
		clearTimeout(debounce);
		client?.dispose();
	});

	function draw(canvas: HTMLCanvasElement | undefined, rgba: Uint8ClampedArray, w: number, h: number): void {
		if (!canvas) return;
		canvas.width = w;
		canvas.height = h;
		canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
	}

	async function load(file: Blob & { name?: string }): Promise<void> {
		error = '';
		try {
			const d = await decodeFile(file, defaultLongEdge());
			size = { w: d.w, h: d.h };
			sourceSize = { w: d.sourceW, h: d.sourceH };
			draw(origCanvas, d.rgba, d.w, d.h);
			await client?.init(d.w, d.h);
			await client?.setImage(d.rgba);
			await sort();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function sort(): Promise<void> {
		if (!client || !size) return;
		busy = true;
		try {
			await client.configure(params);
			const r = await client.run();
			if (r === 'superseded') return;
			stats = r.stats;
			timings = r.timings;
			draw(sortedCanvas, r.rgba, size.w, size.h);
			error = '';
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function changed(): void {
		clearTimeout(debounce);
		debounce = setTimeout(() => void sort(), 100);
	}

	function onFile(e: Event): void {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (f) void load(f);
	}
	function onDrop(e: DragEvent): void {
		e.preventDefault();
		const f = e.dataTransfer?.files[0];
		if (f) void load(f);
	}
	function onPaste(e: ClipboardEvent): void {
		const f = e.clipboardData?.files[0];
		if (f) void load(f);
	}
	const fmt = (n: number): string => n.toFixed(1);
	const preview = $derived(size ? workingSize(size.w, size.h, 1920) : null);
</script>

<svelte:window ondragover={(e) => e.preventDefault()} ondrop={onDrop} onpaste={onPaste} />
<svelte:head><title>Lab · pixelsort-go</title></svelte:head>

<main>
	<h1>Lab</h1>
	<p>
		Drop, paste or choose a picture. <code>crossOriginIsolated</code>: <span data-testid="isolated">{isolated}</span>
	</p>
	<input type="file" accept="image/*" aria-label="Choose a picture" onchange={onFile} data-testid="file" />

	<fieldset>
		<legend>Recipe</legend>
		<label
			>mode <select bind:value={params.mode} onchange={changed}
				>{#each modes as m (m)}<option>{m}</option>{/each}</select
			></label
		>
		<label
			>key <select bind:value={params.key} onchange={changed}
				>{#each keys as k (k)}<option>{k}</option>{/each}</select
			></label
		>
		<label
			>angle <input type="number" min="0" max="359" bind:value={params.angle} oninput={changed} data-testid="angle" />
			<input
				type="range"
				min="0"
				max="359"
				bind:value={params.angle}
				oninput={changed}
				aria-label="angle slider"
			/></label
		>
		<label>length <input type="range" min="1" max="1000" bind:value={params.length} oninput={changed} /></label>
		<label>randomness <input type="range" min="0" max="100" bind:value={params.randomness} oninput={changed} /></label>
		<label>lo <input type="range" min="0" max="255" bind:value={params.lo} oninput={changed} /></label>
		<label>hi <input type="range" min="0" max="255" bind:value={params.hi} oninput={changed} /></label>
		<label>edge <input type="range" min="0" max="255" bind:value={params.edge} oninput={changed} /></label>
		<label>seed <input type="number" min="0" bind:value={params.seed} oninput={changed} /></label>
		<label><input type="checkbox" bind:checked={params.reverse} onchange={changed} /> reverse</label>
	</fieldset>

	{#if error}<p role="alert" class="error">{error}</p>{/if}

	<p data-testid="readout" aria-live="polite">
		{#if size && sourceSize}image {sourceSize.w}×{sourceSize.h}, working {size.w}×{size.h}{#if preview?.scaled}
				(scaled){/if}.{/if}
		{#if stats}{stats.lines} lines, {stats.intervals} intervals, {stats.sortable} sortable, {stats.frozen} frozen.{/if}
		{#if timings}prepare {fmt(timings.prepareMs)} ms, sort {fmt(timings.sortMs)} ms, transfer {fmt(timings.transferMs)} ms.{/if}
		{#if busy}…{/if}
	</p>

	<div class="pair">
		<figure>
			<figcaption>original</figcaption>
			<canvas bind:this={origCanvas} data-testid="original"></canvas>
		</figure>
		<figure>
			<figcaption>sorted</figcaption>
			<canvas bind:this={sortedCanvas} data-testid="sorted"></canvas>
		</figure>
	</div>
</main>

<style>
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
	}
	label {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}
	.pair {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	canvas {
		max-width: min(48vw, 640px);
		height: auto;
		background: #222;
	}
	.error {
		color: #b00020;
	}
</style>
