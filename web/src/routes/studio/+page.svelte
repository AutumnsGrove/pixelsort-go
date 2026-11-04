<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Play, Pause, RotateCcw, Zap, Download, ImagePlus } from '@lucide/svelte';
	import TopBar from '#components/TopBar';
	import AngleDial from '#components/AngleDial';
	import { studio, sampleImage } from '#lib/studio.svelte';
	import { BUILTIN, chips, rolls } from '#lib/presets';
	import { keys, modes, algos } from '#lib/engine/params';
	import { describe } from '#lib/errors';
	import { shortcutFor, SHORTCUTS } from '#lib/help';
	import { clean, fileName } from '#lib/naming';
	import {
		DEVICES,
		FORMATS,
		estimateBytes,
		fmtBytes,
		fmtMP,
		plan,
		suggestScale,
		type FormatId
	} from '#lib/export-model';
	import { settings } from '#lib/settings.svelte';

	let canvas: HTMLCanvasElement | undefined = $state();
	let popover = $state<string | null>(null);
	let helpOpen = $state(false);
	let exportOpen = $state(false);
	let renaming = $state(false);
	let nameDraft = $state('');
	let exportFormat = $state<FormatId>(settings.exportFormat);
	let exportQuality = $state(settings.exportQuality);
	let exportScale = $state(1);
	let fileInput: HTMLInputElement | undefined = $state();
	let originalCopy: ImageData | null = null;

	function paint(rgba: Uint8ClampedArray, w: number, h: number): void {
		if (!canvas) return;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
	}

	onMount(() => {
		studio.onFrame = paint;
		void studio.load(sampleImage());
	});
	onDestroy(() => {
		studio.onFrame = null;
		studio.stop();
	});

	$effect(() => {
		// Hold C to compare: show the original, then the sorted picture again.
		if (!studio.size || !studio.original) return;
		if (studio.comparing) paint(studio.original, studio.size.w, studio.size.h);
		else if (studio.sorted) paint(studio.sorted, studio.size.w, studio.size.h);
	});

	function onKeyDown(e: KeyboardEvent): void {
		const id = shortcutFor(e);
		if (!id) return;
		if (id === 'esc') {
			popover = null;
			helpOpen = false;
			exportOpen = false;
			renaming = false;
		} else if (id === 'play') void studio.togglePlay();
		else if (id === 'restart') void studio.restart();
		else if (id === 'compare') studio.comparing = true;
		else if (id === 'new') fileInput?.click();
		else if (id === 'export') exportOpen = true;
		else if (id === 'help') helpOpen = !helpOpen;
		else if (id === 'rename') startRename();
		else return;
		e.preventDefault();
	}
	function onKeyUp(e: KeyboardEvent): void {
		if (e.key.toLowerCase() === 'c') studio.comparing = false;
	}
	function startRename(): void {
		nameDraft = studio.name;
		renaming = true;
	}
	function commitRename(): void {
		studio.customName = clean(nameDraft) || null;
		renaming = false;
	}
	function onDrop(e: DragEvent): void {
		e.preventDefault();
		const f = e.dataTransfer?.files[0];
		if (f) void studio.loadFile(f);
	}

	const knob = (id: string) => () => (popover = popover === id ? null : id);
	const changed = () => studio.changed();
	const stateText = $derived(
		studio.run === 'animating'
			? `pass ${studio.pass}`
			: studio.run === 'paused'
				? 'paused'
				: studio.run === 'preparing'
					? 'sorting…'
					: studio.run === 'done'
						? 'done'
						: ''
	);
	const err = $derived(studio.errorCode ? describe(studio.errorCode, { name: studio.errorName }) : null);

	// ---- export ----
	const device = $derived(
		typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches ? 'phone' : 'desktop'
	);
	const exportW = $derived(Math.max(1, Math.round((studio.size?.w ?? 1) * exportScale)));
	const exportH = $derived(Math.max(1, Math.round((studio.size?.h ?? 1) * exportScale)));
	const exportPlan = $derived(plan(exportW, exportH, device));
	const exportName = $derived(fileName(studio.name, studio.params.mode, exportFormat, String(studio.params.seed)));

	async function doExport(): Promise<void> {
		if (!studio.sorted || !studio.size) return;
		const c = new OffscreenCanvas(exportW, exportH);
		const src = new OffscreenCanvas(studio.size.w, studio.size.h);
		src
			.getContext('2d')!
			.putImageData(new ImageData(new Uint8ClampedArray(studio.sorted), studio.size.w, studio.size.h), 0, 0);
		c.getContext('2d')!.drawImage(src, 0, 0, exportW, exportH);
		const blob = await c.convertToBlob({ type: `image/${exportFormat}`, quality: exportQuality / 100 });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = exportName;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 2000);
		exportOpen = false;
	}
	void originalCopy;
</script>

<svelte:window
	onkeydown={onKeyDown}
	onkeyup={onKeyUp}
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
	onpaste={(e) => {
		const f = e.clipboardData?.files[0];
		if (f) void studio.loadFile(f);
	}}
/>
<svelte:head><title>Studio · pixelsort-go</title></svelte:head>

<TopBar
	readout={studio.size ? `${studio.size.w}×${studio.size.h} · ${studio.params.mode} · ${studio.params.angle}°` : ''}
/>

<main class="workspace">
	<section class="stage">
		<div class="frame">
			<canvas bind:this={canvas} data-testid="stage" aria-label="Sorted picture"></canvas>
			<div class="progress" aria-hidden="true"><i style:width="{studio.progress * 100}%"></i></div>
			<div class="caption">
				{#if renaming}
					<input
						class="field nm"
						bind:value={nameDraft}
						onkeydown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') commitRename();
							if (e.key === 'Escape') renaming = false;
						}}
						onblur={commitRename}
						aria-label="Name"
						data-testid="name-input"
					/>
				{:else}
					<button class="nm-btn" type="button" onclick={startRename} data-testid="name" title="Click to rename (F2)"
						>{studio.name}</button
					>
				{/if}
				<span data-testid="state">{stateText}</span>
			</div>
			<button
				class="cmp"
				class:on={studio.comparing}
				type="button"
				onpointerdown={() => (studio.comparing = true)}
				onpointerup={() => (studio.comparing = false)}
				onpointerleave={() => (studio.comparing = false)}>hold to compare</button
			>
		</div>
	</section>

	{#if err}
		<div class="er" role="alertdialog" aria-modal="true" aria-labelledby="erT">
			<div class="er-card glass">
				<div class="eyebrow">{err.tone === 'error' ? 'Something broke' : 'Couldn’t do that'}</div>
				<h3 id="erT">{err.title}</h3>
				<p>{err.body}</p>
				<p class="safe">{err.safe}</p>
				<div class="er-foot">
					{#each err.actions as a (a.id)}
						<button
							class="btn"
							class:pri={a.primary}
							type="button"
							onclick={() => {
								studio.errorCode = null;
								if (a.id === 'choose') fileInput?.click();
							}}>{a.label}</button
						>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<div class="dock" role="toolbar" aria-label="Controls">
		<button
			class="play"
			type="button"
			onclick={() => studio.togglePlay()}
			aria-label={studio.run === 'animating' ? 'Pause' : 'Play'}
			data-testid="play"
		>
			{#if studio.run === 'animating'}<Pause size={22} />{:else}<Play size={22} />{/if}
		</button>
		<button class="round" type="button" onclick={() => studio.restart()} aria-label="Start over"
			><RotateCcw size={17} /></button
		>
		<button
			class="round"
			type="button"
			onclick={() => studio.instant()}
			aria-label="Sort instantly"
			data-testid="instant"><Zap size={17} /></button
		>
		<span class="sep"></span>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('preset')} aria-expanded={popover === 'preset'}
				><small>Preset{studio.edited ? ' · edited' : ''}</small><b data-testid="k-preset"
					>{studio.preset?.name ?? 'custom'}</b
				></button
			>
			{#if popover === 'preset'}
				<div class="pop glass wide" role="dialog" aria-label="Presets">
					<div class="pgrid">
						{#each BUILTIN as p (p.id)}
							<button
								type="button"
								class="pcard"
								class:on={studio.presetId === p.id}
								data-p={p.id}
								onclick={() => studio.applyPreset(p)}
							>
								<b>{p.name}</b><span>{p.desc}</span>
								<span class="chips-row"
									>{#each chips(p) as c (c)}<i>{c}</i>{/each}</span
								>
							</button>
						{/each}
					</div>
					{#if studio.preset && rolls(studio.preset)}<button
							class="btn sm"
							type="button"
							onclick={() => studio.preset && studio.applyPreset(studio.preset)}>Roll {studio.preset.name} again</button
						>{/if}
				</div>
			{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('mode')}
				><small>Intervals</small><b data-testid="k-mode">{studio.params.mode}</b></button
			>
			{#if popover === 'mode'}
				<div class="pop glass" role="dialog" aria-label="Intervals">
					<div class="chips">
						{#each modes as m (m)}<button
								type="button"
								class:on={studio.params.mode === m}
								onclick={() => {
									studio.params.mode = m;
									changed();
								}}>{m}</button
							>{/each}
					</div>
					{#if studio.params.mode === 'threshold'}
						<label
							>lowest <input type="range" min="0" max="255" bind:value={studio.params.lo} oninput={changed} /></label
						>
						<label
							>highest <input type="range" min="0" max="255" bind:value={studio.params.hi} oninput={changed} /></label
						>
					{/if}
					{#if studio.params.mode === 'edges' || studio.params.mode === 'ca-edges'}<label
							>edge strength <input
								type="range"
								min="0"
								max="255"
								bind:value={studio.params.edge}
								oninput={changed}
							/></label
						>{/if}
					{#if studio.params.mode === 'ca' || studio.params.mode === 'ca-edges'}
						<label
							>rule <input
								type="number"
								class="field"
								min="0"
								max="255"
								bind:value={studio.params.rule}
								oninput={changed}
							/></label
						>
						<label
							>cell size <input
								type="range"
								min="1"
								max="60"
								bind:value={studio.params.cell}
								oninput={changed}
							/></label
						>
						<div class="chips">
							{#each ['image', 'line'] as s (s)}<button
									type="button"
									class:on={studio.params.caSpace === s}
									onclick={() => {
										studio.params.caSpace = s as 'image' | 'line';
										changed();
									}}>{s} space</button
								>{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('length')}
				><small>Length</small><b
					>{studio.size ? Math.max(1, Math.round((studio.size.w * studio.params.length) / 1000)) : studio.params.length} px</b
				></button
			>
			{#if popover === 'length'}<div class="pop glass">
					<label
						>typical run length <input
							type="range"
							min="1"
							max="400"
							bind:value={studio.params.length}
							oninput={changed}
							aria-label="Length"
						/></label
					>
				</div>{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('unsorted')}
				><small>Unsorted</small><b>{studio.params.randomness}%</b></button
			>
			{#if popover === 'unsorted'}<div class="pop glass">
					<label
						>left alone <input
							type="range"
							min="0"
							max="100"
							bind:value={studio.params.randomness}
							oninput={changed}
							aria-label="Unsorted"
						/></label
					>
				</div>{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('key')}><small>Sort by</small><b>{studio.params.key}</b></button>
			{#if popover === 'key'}
				<div class="pop glass">
					<div class="chips">
						{#each keys as k (k)}<button
								type="button"
								class:on={studio.params.key === k}
								onclick={() => {
									studio.params.key = k;
									changed();
								}}>{k}</button
							>{/each}
					</div>
					<label class="tog"
						><span><b>Reverse</b></span><input
							type="checkbox"
							bind:checked={studio.params.reverse}
							onchange={changed}
						/></label
					>
				</div>
			{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('angle')}
				><small>Direction</small><b data-testid="k-angle">{studio.params.angle}°</b></button
			>
			{#if popover === 'angle'}<div class="pop glass">
					<AngleDial bind:value={studio.params.angle} onchange={changed} />
				</div>{/if}
		</div>

		<div class="kn">
			<button type="button" class="knob" onclick={knob('watch')}
				><small>Watch as</small><b>{studio.params.algo}</b></button
			>
			{#if popover === 'watch'}
				<div class="pop glass">
					<div class="chips">
						{#each algos as a (a)}<button
								type="button"
								class:on={studio.params.algo === a}
								onclick={() => {
									studio.params.algo = a;
									changed();
								}}>{a}</button
							>{/each}
					</div>
					<label
						>speed <input
							type="range"
							min="1"
							max="300"
							value={studio.speed}
							oninput={(e) => studio.setSpeed(Number(e.currentTarget.value))}
							aria-label="Speed"
						/></label
					>
				</div>
			{/if}
		</div>
		<span class="sep"></span>
		<button class="round" type="button" onclick={() => fileInput?.click()} aria-label="New picture"
			><ImagePlus size={17} /></button
		>
		<button class="round" type="button" onclick={() => (exportOpen = true)} aria-label="Export" data-testid="export"
			><Download size={17} /></button
		>
		<button class="round" type="button" onclick={() => (helpOpen = true)} aria-label="Shortcuts">?</button>
	</div>
</main>

<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	class="sr-only"
	data-testid="file"
	onchange={(e) => {
		const f = e.currentTarget.files?.[0];
		if (f) void studio.loadFile(f);
	}}
/>

{#if helpOpen}
	<div class="er" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
		<div class="er-card glass">
			<div class="eyebrow">Keyboard</div>
			<h3>Shortcuts</h3>
			{#each SHORTCUTS as g (g.group)}
				<h4 class="eyebrow gh">{g.group}</h4>
				{#each g.items as i (i.id)}<div class="hp-row"><span>{i.what}</span><kbd>{i.keys.join(' ')}</kbd></div>{/each}
			{/each}
			<div class="er-foot"><button class="btn pri" type="button" onclick={() => (helpOpen = false)}>Close</button></div>
		</div>
	</div>
{/if}

{#if exportOpen}
	<div class="er" role="dialog" aria-modal="true" aria-label="Export">
		<div class="er-card glass">
			<div class="eyebrow">Export</div>
			<h3>Save this picture</h3>
			<div class="chips">
				{#each Object.entries(FORMATS) as [id, f] (id)}<button
						type="button"
						class:on={exportFormat === id}
						onclick={() => (exportFormat = id as FormatId)}>{f.name}</button
					>{/each}
			</div>
			<p class="sub">{FORMATS[exportFormat].note}</p>
			{#if FORMATS[exportFormat].lossy}<label
					>quality {exportQuality} <input type="range" min="40" max="100" bind:value={exportQuality} /></label
				>{/if}
			<div class="chips">
				{#each [1, 0.75, 0.5, 0.25] as s (s)}<button
						type="button"
						class:on={exportScale === s}
						onclick={() => (exportScale = s)}>{Math.round(s * 100)}%</button
					>{/each}
			</div>
			<p class="sub" data-testid="export-info">
				{exportW}×{exportH} · {fmtMP(exportW * exportH)} · about {fmtBytes(
					estimateBytes(exportFormat, exportQuality, exportW * exportH)
				)} · {exportName}
			</p>
			{#if exportPlan.verdict === 'toolarge'}<p class="safe" data-testid="verdict">
					Too large for this {DEVICES[device].name.toLowerCase()}. {suggestScale(
						studio.size?.w ?? 1,
						studio.size?.h ?? 1,
						device
					)
						? 'Try ' + Math.round((suggestScale(studio.size?.w ?? 1, studio.size?.h ?? 1, device) ?? 1) * 100) + '%.'
						: ''}
				</p>{/if}
			<div class="er-foot">
				<button class="btn" type="button" onclick={() => (exportOpen = false)}>Cancel</button>
				<button
					class="btn pri"
					type="button"
					disabled={exportPlan.verdict === 'toolarge'}
					onclick={doExport}
					data-testid="export-go">Export {FORMATS[exportFormat].name}</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.workspace {
		position: fixed;
		inset: 0;
		z-index: 5;
	}
	.stage {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 70px 20px 170px;
	}
	.frame {
		position: relative;
		box-shadow:
			0 0 0 1px rgba(236, 228, 211, 0.12),
			0 40px 120px rgba(255, 90, 40, 0.18),
			0 20px 60px rgba(0, 0, 0, 0.7);
		max-width: min(88vw, 1100px);
		max-height: calc(100vh - 250px);
		display: grid;
	}
	canvas {
		display: block;
		max-width: 100%;
		max-height: calc(100vh - 250px);
		width: auto;
		height: auto;
	}
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -6px;
		height: 2px;
		background: var(--faint);
	}
	.progress i {
		display: block;
		height: 100%;
		background: var(--ver);
		box-shadow: 0 0 10px var(--ver);
	}
	.caption {
		position: absolute;
		left: 0;
		bottom: -34px;
		font-family: var(--serif);
		font-style: italic;
		font-size: 16px;
		color: var(--dim);
		display: flex;
		gap: 12px;
		align-items: baseline;
	}
	.caption span {
		font-family: var(--mono);
		font-style: normal;
		font-size: 10px;
		letter-spacing: 1.2px;
	}
	.nm-btn {
		font: inherit;
		color: var(--paper);
		min-height: 32px;
	}
	.nm {
		width: 30ch;
		font-style: italic;
	}
	.cmp {
		position: absolute;
		right: 0;
		bottom: -34px;
		font-size: 10px;
		letter-spacing: 1.6px;
		text-transform: uppercase;
		color: var(--dim);
		min-height: 32px;
		user-select: none;
	}
	.cmp.on {
		color: var(--ver);
	}
	.dock {
		position: absolute;
		left: 50%;
		bottom: 26px;
		transform: translateX(-50%);
		z-index: 25;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		max-width: calc(100vw - 24px);
		background: rgba(24, 20, 18, 0.78);
		backdrop-filter: blur(18px);
		border: 1px solid var(--faint);
		border-radius: 999px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
	}
	.play {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--ver);
		color: var(--ink);
		display: grid;
		place-items: center;
		flex: none;
	}
	.sep {
		width: 1px;
		height: 30px;
		background: var(--faint);
		margin: 0 6px;
		flex: none;
	}
	.kn {
		position: relative;
	}
	.knob {
		display: grid;
		text-align: left;
		padding: 6px 12px;
		border-radius: 14px;
		min-height: 44px;
	}
	.knob:hover {
		background: var(--faint2);
	}
	.knob small {
		font-size: 9px;
		letter-spacing: 1.4px;
		text-transform: uppercase;
		color: var(--dim);
	}
	.knob b {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 17px;
		white-space: nowrap;
	}
	.pop {
		position: absolute;
		bottom: calc(100% + 14px);
		left: 50%;
		transform: translateX(-50%);
		padding: 16px;
		display: grid;
		gap: 12px;
		min-width: 240px;
		z-index: 40;
	}
	.pop.wide {
		width: min(640px, 90vw);
	}
	.pop label {
		display: grid;
		gap: 2px;
		font-size: 11px;
		color: var(--dim);
	}
	.pgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px;
	}
	.pcard {
		text-align: left;
		padding: 10px 12px;
		border: 1px solid var(--faint);
		border-radius: 14px;
		display: grid;
		gap: 4px;
	}
	.pcard:hover,
	.pcard.on {
		border-color: var(--ver);
	}
	.pcard b {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 18px;
	}
	.pcard span {
		font-size: 10px;
		color: var(--dim);
		line-height: 1.5;
	}
	.chips-row i {
		font-style: normal;
		border: 1px solid var(--faint);
		border-radius: 99px;
		padding: 1px 7px;
		margin-right: 4px;
	}
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
		gap: 10px;
		max-height: 90vh;
		overflow: auto;
	}
	.er-card h3 {
		font-size: 32px;
		line-height: 1.05;
	}
	.er-card p {
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.7;
	}
	.er-card p.safe {
		color: var(--paper);
		padding-left: 12px;
		border-left: 2px solid var(--ok);
	}
	.er-foot {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		margin-top: 10px;
	}
	.hp-row {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		border-bottom: 1px solid var(--faint2);
		font-size: 11.5px;
	}
	.hp-row kbd {
		border: 1px solid var(--faint);
		border-radius: 6px;
		padding: 2px 8px;
	}
	.gh {
		margin-top: 8px;
	}
</style>
