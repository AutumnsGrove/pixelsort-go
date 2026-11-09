<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		Play,
		Pause,
		RotateCcw,
		Save,
		Check,
		Download,
		ImagePlus,
		Link2,
		SlidersHorizontal,
		Film
	} from '@lucide/svelte';
	import { beforeNavigate } from '$app/navigation';
	import { saveButton, createLeaveGuard } from '#lib/save-policy';
	import TopBar from '#components/TopBar';
	import ProPanel from '#components/ProPanel';
	import AnimationPanel from '#components/AnimationPanel';
	import Strip from '#components/Strip';
	import MaskHandles from '#components/MaskHandles';
	import CutoutLayer from '#components/CutoutLayer';
	import BrushLayer from '#components/BrushLayer';
	import ProtectBar from '#components/ProtectBar';
	import BrushExit from '#components/BrushExit';
	import Tour from '#components/Tour';
	import { seen as touredBefore } from '#lib/tour';
	import { isSvgFile, looksLikeSvg } from '#lib/svg-shapes';
	import { holdPixels, overlayPixels } from '#lib/overlay';
	import { appBusy } from '#lib/updater/state.svelte';
	import AngleDial from '#components/AngleDial';
	import NameField from '#components/NameField';
	import { studio, defaultImage, ENGINE_VERSION } from '#lib/studio.svelte';
	import { ServerBackend } from '#lib/api';
	import { BUILTIN, chips, rolls } from '#lib/presets';
	import { keys, modes, algos } from '#lib/engine/params';
	import { describe } from '#lib/errors';
	import { shortcutFor, SHORTCUTS } from '#lib/help';
	import { fileName } from '#lib/naming';
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
	import { ShareBackend, type Features } from '#lib/share';

	let canvas: HTMLCanvasElement | undefined = $state();
	let overlay: HTMLCanvasElement | undefined = $state();
	let proOpen = $state(false);
	let popover = $state<string | null>(null);
	let helpOpen = $state(false);
	let exportOpen = $state(false);
	let animOpen = $state(false);
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
		const wanted = new URL(location.href).searchParams.get('run');
		const sample = (): Promise<void> => defaultImage().then((img) => studio.load(img, { sample: true }));
		if (wanted && /^\d+$/.test(wanted)) {
			// "Open in Studio" from the Archive: the whole look comes back, and the next save is a branch of this run
			void new ServerBackend()
				.getRun(Number(wanted))
				.then((run) => studio.openRun(run))
				.catch(() => {
					studio.errorCode = 'image-unreadable';
					studio.errorName = 'that run';
				})
				.finally(() => {
					if (!studio.size) void sample(); // never leave Studio empty
				});
		} else void sample();
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

	$effect(() => {
		// Cell outlines and class tints, drawn from the engine's own label map so they agree with what sorts.
		const c = overlay;
		const size = studio.size;
		if (!c || !size) return;
		c.width = size.w;
		c.height = size.h;
		const g = c.getContext('2d');
		if (!g) return;
		g.clearRect(0, 0, size.w, size.h);
		if (studio.peeking && studio.movable && studio.movable.length === size.w * size.h) {
			g.putImageData(
				new ImageData(holdPixels(studio.movable, size.w, size.h) as Uint8ClampedArray<ArrayBuffer>, size.w, size.h),
				0,
				0
			);
		} else if (studio.labels && studio.classOf && studio.showCells && studio.labels.length === size.w * size.h) {
			g.putImageData(
				new ImageData(
					overlayPixels(studio.labels, studio.classOf, size.w, size.h) as Uint8ClampedArray<ArrayBuffer>,
					size.w,
					size.h
				),
				0,
				0
			);
		}
	});

	function onKeyDown(e: KeyboardEvent): void {
		const id = shortcutFor(e);
		if (!id) return;
		if (id === 'esc') {
			// Esc backs out one layer at a time: whatever is being typed or shown first, and the brush only when nothing else is.
			const inTheWay = popover !== null || helpOpen || exportOpen || animOpen || studio.renameFrom !== null;
			popover = null;
			helpOpen = false;
			exportOpen = false;
			animOpen = false;
			studio.cancelRename();
			if (!inTheWay) studio.exitTool();
		} else if (id === 'pro') proOpen = !proOpen;
		else if (id === 'paint') studio.togglePaint();
		else if (id === 'play') void studio.togglePlay();
		else if (id === 'restart') void studio.restart();
		else if (id === 'compare') studio.comparing = true;
		else if (id === 'peek') void studio.peek(true);
		else if (id === 'runs') stripOpen = !stripOpen;
		else if (id === 'new') fileInput?.click();
		else if (id === 'export') exportOpen = true;
		else if (id === 'help') helpOpen = !helpOpen;
		else if (id === 'rename') studio.startRename('caption');
		else return;
		e.preventDefault();
	}
	function onKeyUp(e: KeyboardEvent): void {
		if (e.key.toLowerCase() === 'c') studio.comparing = false;
		if (e.key.toLowerCase() === 't') void studio.peek(false);
	}
	let features = $state<Features>({ share: false, fetch: false });
	let linkOpen = $state(false);
	let stripOpen = $state(false);
	let tourOpen = $state(false);
	let linkDraft = $state('');
	onMount(() => {
		void new ShareBackend().features().then((f) => (features = f));
		// first run, or "Take the tour" in Settings (?tour)
		if (!touredBefore() || new URLSearchParams(location.search).has('tour')) tourOpen = true;
	});
	function submitLink(): void {
		const url = linkDraft.trim();
		if (!url) return;
		linkOpen = false;
		void studio.loadUrl(url, features);
	}
	function onDrop(e: DragEvent): void {
		e.preventDefault();
		const f = e.dataTransfer?.files[0];
		if (f) void (isSvgFile(f) ? takeSvg(f) : studio.loadFile(f));
	}
	/** An SVG is a shape for the library, not a picture: hand its text to the Pro panel's shape library. */
	async function takeSvg(f: Blob): Promise<void> {
		studio.pendingSvg = await f.text();
		proOpen = true;
	}

	const knob = (id: string) => () => (popover = popover === id ? null : id);
	const changed = () => studio.changed();
	// The compact protect bar is the way to keep painting or editing shapes with the Pro panel out of the way. It is
	// shown whenever one of those tools is in play, not only while the panel is open.
	const protectBar = $derived(
		!!studio.size && (studio.tool !== 'move' || studio.maskObjects.length > 0 || studio.maskStrokes.length > 0)
	);
	const loadingText = $derived(
		studio.engineLoad
			? studio.engineLoad.total
				? `loading the engine… ${Math.min(100, Math.round((studio.engineLoad.loaded / studio.engineLoad.total) * 100))}%`
				: 'loading the engine…'
			: ''
	);
	// ---- saving: nothing is stored until Save (or Export), unless "Auto-save runs" is on ----
	const sorting = $derived(studio.run === 'preparing' || studio.run === 'animating' || studio.pendingChange);
	const sb = $derived(saveButton(studio.saveStatus, sorting));
	// Said next to the state, not inside it: the state text stays exactly "done" / "paused" / "pass 12".
	const unsavedNote = $derived(
		!settings.autoSave && !studio.isSample && studio.run === 'done' && studio.saveStatus !== 'saved'
	);
	const stateText = $derived(
		loadingText
			? loadingText + (studio.engineLoad && studio.engineLoad.attempt > 1 ? ' (trying again)' : '')
			: studio.run === 'animating'
				? studio.rewinding
					? 'rewinding'
					: `pass ${studio.pass}`
				: studio.run === 'paused'
					? 'paused'
					: studio.run === 'preparing'
						? 'sorting…'
						: studio.run === 'done'
							? 'done'
							: ''
	);
	const err = $derived(
		studio.errorCode ? describe(studio.errorCode, { name: studio.errorName, reason: studio.saveReason }) : null
	);

	// Leaving with a look that was never saved warns once (a note here, or the browser's own prompt on closing the tab);
	// a second attempt goes through. It never blocks twice.
	const leaveGuard = createLeaveGuard();
	let leaveWarn = $state(false);
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;
	beforeNavigate((nav) => {
		const dirty = !settings.autoSave && !studio.isSample && studio.dirty;
		if (leaveGuard.check(dirty, studio.lookKey) !== 'warn') return;
		nav.cancel();
		if (nav.type !== 'leave') {
			leaveWarn = true;
			clearTimeout(leaveTimer);
			leaveTimer = setTimeout(() => (leaveWarn = false), 8000);
		}
	});
	$effect(() => {
		if (studio.saveStatus === 'saved') leaveWarn = false;
	});

	// ---- export ----
	const device = $derived(
		typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches ? 'phone' : 'desktop'
	);
	const exportW = $derived(Math.max(1, Math.round((studio.size?.w ?? 1) * exportScale)));
	const exportH = $derived(Math.max(1, Math.round((studio.size?.h ?? 1) * exportScale)));
	const exportPlan = $derived(plan(exportW, exportH, device));
	/** The file name the picture will export as, for the name being typed. */
	const exportName = $derived(fileName(studio.name, studio.params.mode, exportFormat, String(studio.params.seed)));

	async function doExport(): Promise<void> {
		// The same pixels Save stores: after a loop has come home the canvas is on the original, but the run is the sort.
		const pixels = studio.result;
		if (!pixels || !studio.size) return;
		appBusy.exporting = true; // an update must wait for this: Settings shows "Finish your export first."
		try {
			const c = new OffscreenCanvas(exportW, exportH);
			const src = new OffscreenCanvas(studio.size.w, studio.size.h);
			src
				.getContext('2d')!
				.putImageData(new ImageData(new Uint8ClampedArray(pixels), studio.size.w, studio.size.h), 0, 0);
			c.getContext('2d')!.drawImage(src, 0, 0, exportW, exportH);
			const blob = await c.convertToBlob({ type: `image/${exportFormat}`, quality: exportQuality / 100 });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = exportName;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 2000);
			exportOpen = false;
			void studio.save(); // an export is deliberate, so the look is kept too, whichever way auto-save is set
		} finally {
			appBusy.exporting = false;
		}
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
		if (f) return void (isSvgFile(f) ? takeSvg(f) : studio.loadFile(f));
		const text = e.clipboardData?.getData('text')?.trim() ?? '';
		// pasted SVG code becomes a shape (unless you are typing it into a field, which already holds it)
		if (looksLikeSvg(text) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
			studio.pendingSvg = text;
			proOpen = true;
			return;
		}
		// a pasted address loads the picture, unless you are typing into a field
		if (
			/^https?:\/\/\S+$/.test(text) &&
			!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
		)
			void studio.loadUrl(text, features);
	}}
/>
<svelte:head><title>Studio · pixelsort-go</title></svelte:head>

<TopBar
	readout={studio.size ? `${studio.size.w}×${studio.size.h} · ${studio.params.mode} · ${studio.params.angle}°` : ''}
/>

<main class="workspace">
	<section class="stage" class:sheet={proOpen} class:protect={protectBar}>
		<div class="col">
			<div class="frame">
				<canvas bind:this={canvas} data-testid="stage" aria-label="Sorted picture"></canvas>
				<canvas bind:this={overlay} class="overlay" data-testid="overlay" aria-hidden="true"></canvas>
				<BrushLayer />
				<MaskHandles />
				<CutoutLayer />
				<BrushExit sheetOpen={proOpen} />
				{#if studio.scrubbable}
					<input
						class="scrub"
						type="range"
						min="0"
						max={studio.maxPass}
						step="1"
						value={studio.pass}
						oninput={(e) => void studio.scrub(Number(e.currentTarget.value))}
						aria-label="Scrub through the sort"
						aria-valuetext="pass {studio.pass} of {studio.maxPass}"
						data-testid="scrub"
					/>
				{/if}
			</div>
			<div class="progress" aria-hidden="true" data-testid="progress">
				<i style:width="{studio.progress * 100}%"></i>
			</div>
			<!-- A fixed-height row in the flow: the name, the state, and compare. Renaming opens over the space below it, so
			     the picture never moves when the field appears. -->
			<div class="under" data-testid="under">
				<div class="caption" data-testid="caption" class:editing={studio.renameFrom === 'caption'}>
					<NameField from="caption" testid="name" />
					<span data-testid="state">{stateText}</span>
					{#if unsavedNote}<span class="unsaved" data-testid="unsaved-note">not saved</span>{/if}
				</div>
				<button
					class="cmp"
					data-testid="compare"
					class:on={studio.comparing}
					type="button"
					onpointerdown={() => (studio.comparing = true)}
					onpointerup={() => (studio.comparing = false)}
					onpointerleave={() => (studio.comparing = false)}><span class="long">hold to</span> compare</button
				>
			</div>
			{#if protectBar}<ProtectBar onopen={() => (proOpen = true)} />{/if}
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
								const code = err?.code ?? ''; // read it before clearing: the dialog's own state is derived from it
								studio.errorCode = null;
								if (a.id === 'choose') fileInput?.click();
								if (a.id === 'retry' && code.startsWith('link-')) linkOpen = true;
								// a failed save: the same save again
								else if (a.id === 'retry' && code === 'save-failed') void studio.save(true);
								// engine failures: start the worker over (the picture and recipe stay), or reload the whole page
								else if ((a.id === 'retry' || a.id === 'restart') && code.startsWith('engine-'))
									void studio.restartEngine();
								if (a.id === 'reload') location.reload();
							}}>{a.label}</button
						>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	{#if studio.engineNote}
		<div class="enote glass" role="status" data-testid="engine-note">
			<span
				>This run was made with engine version {studio.engineNote}; this one is {ENGINE_VERSION}, so it may look
				different. Saving makes a new run and leaves the original as it is.</span
			>
			<button class="btn sm" type="button" onclick={() => (studio.engineNote = null)}>OK</button>
		</div>
	{/if}

	{#if leaveWarn}
		<div class="leave glass" role="status" data-testid="leave-warn">
			<span>This look isn’t saved yet. Press Save to keep it, or leave again to let it go.</span>
			<button class="btn sm pri" type="button" onclick={() => void studio.save(true)}>Save</button>
		</div>
	{/if}

	<div class="dock" role="toolbar" aria-label="Controls">
		<div class="lead">
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
				class="save"
				type="button"
				onclick={() => void studio.save(true)}
				disabled={sb.disabled || !studio.size}
				title={sb.title}
				data-testid="save"
				data-state={studio.saveStatus}
				>{#if studio.saveStatus === 'saved'}<Check size={16} />{:else}<Save size={16} />{/if}<span>{sb.label}</span
				></button
			>
		</div>
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
					<label class="loop"
						><input
							type="checkbox"
							checked={studio.loop}
							onchange={(e) => studio.setLoop(e.currentTarget.checked)}
							data-testid="loop"
						/>
						loop the sort <span>sort, unsort, start again</span></label
					>
				</div>
			{/if}
		</div>
		<span class="sep"></span>
		<button
			class="round"
			type="button"
			class:on={proOpen}
			onclick={() => (proOpen = !proOpen)}
			aria-label="Pro panel"
			aria-pressed={proOpen}
			data-testid="pro-toggle"><SlidersHorizontal size={17} /></button
		>
		<button class="round" type="button" onclick={() => fileInput?.click()} aria-label="New picture"
			><ImagePlus size={17} /></button
		>
		<button
			class="round"
			type="button"
			onclick={() => (linkOpen = true)}
			aria-label="Load from a link"
			data-testid="link-open"><Link2 size={17} /></button
		>
		<button class="round" type="button" onclick={() => (animOpen = true)} aria-label="Animate" data-testid="animate"
			><Film size={17} /></button
		>
		<button class="round" type="button" onclick={() => (exportOpen = true)} aria-label="Export" data-testid="export"
			><Download size={17} /></button
		>
		<button class="round" type="button" onclick={() => (helpOpen = true)} aria-label="Shortcuts">?</button>
	</div>
</main>

{#if proOpen}<ProPanel onclose={() => (proOpen = false)} />{/if}
{#if animOpen}<AnimationPanel onclose={() => (animOpen = false)} />{/if}

<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	class="sr-only"
	data-testid="file"
	aria-label="Choose a picture"
	onchange={(e) => {
		const f = e.currentTarget.files?.[0];
		if (f) void studio.loadFile(f);
	}}
/>

{#if tourOpen}
	<Tour ondone={() => (tourOpen = false)} />
{/if}

{#if stripOpen}
	<Strip onopen={(r) => void studio.openRun(r)} />
{/if}

{#if linkOpen}
	<div class="er" role="dialog" aria-modal="true" aria-label="Load from a link">
		<form
			class="er-card glass"
			onsubmit={(e) => {
				e.preventDefault();
				submitLink();
			}}
		>
			<div class="eyebrow">Load from a link</div>
			<h3>Paste a picture’s address</h3>
			<input
				class="field"
				type="url"
				placeholder="https://…"
				bind:value={linkDraft}
				aria-label="Picture address"
				data-testid="link-input"
			/>
			<p class="sub">
				{features.fetch
					? 'If the site blocks your browser, your server fetches it for you.'
					: 'The site has to allow it. Otherwise save the picture and drop the file here.'}
			</p>
			<div class="er-foot">
				<button class="btn" type="button" onclick={() => (linkOpen = false)}>Cancel</button>
				<button class="btn pri" type="submit">Load</button>
			</div>
		</form>
	</div>
{/if}

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
		padding: 70px 20px 116px;
	}
	.frame {
		position: relative;
		box-shadow:
			0 0 0 1px rgba(236, 228, 211, 0.12),
			0 40px 120px rgba(255, 90, 40, 0.18),
			0 20px 60px rgba(0, 0, 0, 0.7);
		max-width: min(88vw, 1100px);
		max-height: calc(100vh - 246px);
		display: grid;
	}
	/* The compact protect bar adds a row under the picture; the picture gives up that height instead of the bar running
	   into the dock. Where the bar is hidden (a phone, or a window too short for it) BrushExit takes over and nothing shrinks. */
	@media (min-width: 701px) and (min-height: 561px) {
		.stage.protect .frame {
			max-height: calc(100vh - 298px);
		}
		.stage.protect canvas {
			max-height: calc(100vh - 298px);
		}
	}
	canvas {
		display: block;
		max-width: 100%;
		max-height: calc(100vh - 246px);
		width: auto;
		height: auto;
	}
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.round.on {
		color: var(--ver);
	}
	/* The scrub slider sits inside the picture's bottom edge; 44 px tall on a phone so a thumb can hold it. */
	.scrub {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 8px;
		width: calc(100% - 24px);
		z-index: 7;
		opacity: 0.85;
	}
	@media (max-width: 600px) {
		.scrub {
			min-height: 44px;
			bottom: 0;
		}
	}
	.col {
		display: grid;
		max-width: min(88vw, 1100px);
	}
	.progress {
		height: 2px;
		margin-top: 8px;
		background: var(--faint);
	}
	.progress i {
		display: block;
		height: 100%;
		background: var(--ver);
		box-shadow: 0 0 10px var(--ver);
	}
	/* Fixed height, and no width of its own: it never makes the picture's column wider or taller. */
	.under {
		position: relative;
		height: 44px;
		width: 0;
		min-width: 100%;
		margin-top: 6px;
		container-type: inline-size;
	}
	/* When the picture is small (the Pro sheet is open on a phone) the row has no room for everything: the note, then Compare,
	   step aside rather than land on the state. The Save button in the dock still says whether the look is stored. */
	@container (max-width: 230px) {
		.caption .unsaved {
			display: none;
		}
	}
	@container (max-width: 130px) {
		.cmp {
			display: none;
		}
	}
	.caption {
		position: absolute;
		left: 0;
		top: 0;
		max-width: calc(100% - 138px);
		min-height: 44px;
		font-family: var(--serif);
		font-style: italic;
		font-size: 16px;
		color: var(--dim);
		display: flex;
		gap: 12px;
		align-items: center;
		z-index: 6;
	}
	/* The name gives way first (with an ellipsis); the state and the unsaved note keep their words. */
	.caption {
		min-width: 0;
		flex-wrap: nowrap;
	}
	.caption :global(.nm-btn) {
		min-width: 0;
		flex: 0 1 auto;
	}
	.caption .unsaved,
	.caption span[data-testid='state'] {
		flex: none;
	}
	@media (max-width: 480px) {
		/* "compare" is enough on a phone, and the caption gets the room */
		.cmp .long {
			display: none;
		}
		.caption {
			max-width: calc(100% - 86px);
		}
	}
	.caption.editing {
		width: 100%;
		max-width: 100%;
		align-items: flex-start;
		padding: 0 10px 8px 0;
		background: #0c0a09;
		border-radius: 12px;
		z-index: 30;
	}
	/* While the field is open it has the whole row: the state and the unsaved note step aside. */
	.caption.editing > span {
		display: none;
	}
	.caption .unsaved {
		font-family: var(--mono);
		font-style: normal;
		font-size: 10px;
		letter-spacing: 1.2px;
		color: var(--ver);
		white-space: nowrap;
	}
	.caption span[data-testid='state'] {
		font-family: var(--mono);
		font-style: normal;
		font-size: 10px;
		letter-spacing: 1.2px;
		white-space: nowrap;
	}
	.cmp {
		position: absolute;
		right: 0;
		top: 0;
		font-size: 10px;
		letter-spacing: 1.6px;
		text-transform: uppercase;
		color: var(--dim);
		min-height: 44px;
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
	/* The transport stays put when a phone's dock scrolls sideways, so Save is never out of reach. */
	.lead {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
		position: sticky;
		left: 0;
		z-index: 3;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 44px;
		padding: 0 15px;
		border-radius: 22px;
		border: 1px solid var(--faint);
		font-size: 11px;
		letter-spacing: 1.2px;
		text-transform: uppercase;
		color: var(--paper);
		flex: none;
	}
	.save[data-state='unsaved'] {
		border-color: var(--ver);
		color: var(--ver);
	}
	.save[data-state='saved'] {
		color: var(--dim);
	}
	.save[data-state='failed'] {
		border-color: #ff8a6e;
		color: #ff8a6e;
	}
	.save:disabled {
		opacity: 0.45;
	}
	.enote {
		position: absolute;
		left: 50%;
		top: 64px;
		transform: translateX(-50%);
		z-index: 26;
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 16px;
		font-size: 11.5px;
		max-width: min(92vw, 620px);
	}
	.leave {
		position: absolute;
		left: 50%;
		bottom: 118px;
		transform: translateX(-50%);
		z-index: 26;
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 16px;
		font-size: 11.5px;
		max-width: min(92vw, 560px);
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
	.pop label.loop {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.pop label.loop span {
		opacity: 0.7;
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

	/* Phone and tablet: the dock is a full-width bar that scrolls sideways (its contents are about 1020px wide, so anything narrower
	   than about 1050px would push the Pro button off screen), and popovers become sheets above it. The dock drops its transform
	   and backdrop blur so position: fixed popovers are placed against the screen, not the dock. */
	@media (max-width: 1050px) {
		.dock {
			left: 8px;
			right: 8px;
			bottom: 10px;
			transform: none;
			max-width: none;
			backdrop-filter: none;
			background: rgba(24, 20, 18, 0.96);
			border-radius: 28px;
			overflow-x: auto;
			scrollbar-width: none;
			padding: 8px 10px;
		}
		.knob,
		.lead {
			background: rgba(24, 20, 18, 0.96);
			border-radius: 28px;
			padding-right: 4px;
		}
		.dock .round {
			min-height: 44px;
			min-width: 44px;
		}
		.pop,
		.pop.wide {
			position: fixed;
			left: 8px;
			right: 8px;
			bottom: 86px;
			transform: none;
			width: auto;
			min-width: 0;
			max-height: 56dvh;
			overflow: auto;
		}
	}

	/* Phone: the picture and the Pro sheet share the screen above the dock. */
	@media (max-width: 700px) {
		.stage {
			padding: 64px 10px 106px;
		}
		/* The Pro panel is a bottom sheet (46vh, above the dock): the picture moves up and shrinks to stay in view. */
		.stage.sheet {
			padding-bottom: calc(46dvh + 114px);
		}
		.frame {
			max-width: 100%;
			max-height: calc(100dvh - 232px);
		}
		.stage.sheet .frame {
			max-height: calc(54dvh - 240px);
		}
		canvas {
			max-height: calc(100dvh - 232px);
		}
		.stage.sheet canvas {
			max-height: calc(54dvh - 240px);
		}
		.er-card {
			padding: 20px 18px 16px;
		}
	}
</style>
