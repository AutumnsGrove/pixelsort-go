<script lang="ts">
	// The animation panel: export-only controls, a preview of the exact frame sequence the export will write, and the
	// export itself. It runs on its own engine session so the studio's live sort is untouched.
	import { onMount, tick as nextTick } from 'svelte';
	import { X, Play, Pause, Download, Square } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';
	import {
		ANIM_DURATIONS,
		ANIM_FORMATS,
		ANIM_FPS,
		ANIM_HOLDS,
		ANIM_SCALES,
		DEFAULT_ANIM,
		evenSize,
		PREVIEW_SPEEDS,
		animFilename,
		clampFrame,
		estimateBytes,
		memoryRefusal,
		memoryWarning,
		nextFrame,
		outputSize,
		previewDelay,
		previewSize,
		sequenceFor,
		settingsProblem,
		type AnimFormat,
		type AnimSettings
	} from '#lib/anim-panel';
	import { fmtBytes, fmtMP } from '#lib/export-model';
	import { clientFrameSource, createEncoder, exportAnimation } from '#lib/export-anim';
	import { scaleFrame } from '#lib/anim-frame';
	import { videoSupport, type VideoSupport } from '#lib/anim-video-support';
	import type { EngineClient } from '#lib/engine/client';

	let { onclose }: { onclose: () => void } = $props();

	let settings = $state<AnimSettings>({ ...DEFAULT_ANIM });
	let session = $state.raw<{ client: EngineClient; maxPasses: number; w: number; h: number } | null>(null);
	let maxPasses = $state(0);
	let index = $state(0);
	let playing = $state(false);
	let speed = $state(1);
	let loading = $state(true);
	let exporting = $state(false);
	let progress = $state(0);
	let error = $state<string | null>(null);
	let saved = $state<string | null>(null);
	let video = $state<VideoSupport>({ mp4: false, webm: false, note: null });
	let canvas: HTMLCanvasElement | undefined = $state();
	let card: HTMLDivElement | undefined = $state();
	let previousFocus: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: AbortController | null = null;
	let drawSeq = 0;
	let videoSeq = 0;

	const size = $derived(studio.size);
	const device = $derived(
		typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches ? 'phone' : 'desktop'
	);
	const rawOut = $derived(size ? outputSize(size.w, size.h, settings.scale) : { w: 1, h: 1 });
	const isVideo = $derived(settings.format === 'mp4' || settings.format === 'webm');
	const out = $derived(isVideo ? evenSize(rawOut.w, rawOut.h) : rawOut);
	const seq = $derived(sequenceFor(settings, maxPasses));
	const frames = $derived(seq.passes.length);
	const prev = $derived(previewSize(out.w, out.h));
	const estimate = $derived(estimateBytes(settings.format, frames, out.w * out.h));
	const warning = $derived(memoryWarning(settings.format, frames, out.w * out.h, device));
	const refusal = $derived(memoryRefusal(settings.format, frames, out.w * out.h, device));
	const problem = $derived(settingsProblem(settings));
	const name = $derived(animFilename(studio.name, settings.format));

	onMount(() => {
		previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		card?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
		void open();
		return () => {
			pause();
			abort?.abort();
			session?.client.dispose();
			previousFocus?.focus();
		};
	});

	async function open(): Promise<void> {
		loading = true;
		try {
			const s = await studio.animationSession();
			if (!s) {
				error = 'There is no picture to animate yet.';
				return;
			}
			session = s;
			maxPasses = s.maxPasses;
			await checkVideo();
			// The canvas only exists once loading is false; wait for it before drawing the first frame.
			loading = false;
			await nextTick();
			await show(0);
		} catch {
			error = 'The animation engine could not start. Close the panel and try again.';
		} finally {
			loading = false;
		}
	}

	/** Seeks one frame and draws it; a newer seek wins, so a fast scrub never draws an old frame. */
	/** Video formats are only offered when WebCodecs can encode one here. */
	async function checkVideo(): Promise<void> {
		const my = ++videoSeq;
		try {
			// Probe the even size the video encoder will actually receive, whatever format is selected now.
			const probe = evenSize(rawOut.w, rawOut.h);
			const next = await videoSupport(probe.w, probe.h, settings.fps);
			if (my === videoSeq) video = next;
		} catch {
			if (my !== videoSeq) return;
			video = { mp4: false, webm: false, note: 'The video encoder could not be checked. GIF and APNG still work.' };
		}
	}

	function supported(format: AnimFormat): boolean {
		if (format === 'mp4') return video.mp4;
		if (format === 'webm') return video.webm;
		return true;
	}

	async function show(i: number): Promise<void> {
		if (!session || !size) return;
		const my = ++drawSeq;
		const at = clampFrame(i, frames);
		index = at;
		const r = await session.client.seek(seq.passes[at] ?? 0);
		if (my !== drawSeq || r === 'superseded') return;
		draw(r.rgba);
	}

	function draw(rgba: Uint8ClampedArray): void {
		if (!canvas || !size) return;
		if (canvas.width !== prev.w) canvas.width = prev.w;
		if (canvas.height !== prev.h) canvas.height = prev.h;
		const scaled = scaleFrame({ rgba, w: size.w, h: size.h }, prev.w, prev.h);
		canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(scaled.rgba), prev.w, prev.h), 0, 0);
	}

	function play(): void {
		if (playing || !session) return;
		playing = true;
		if (index >= frames - 1) void show(0);
		tick();
	}

	function pause(): void {
		playing = false;
		clearTimeout(timer);
	}

	function tick(): void {
		clearTimeout(timer);
		if (!playing) return;
		timer = setTimeout(
			() => {
				if (!playing) return;
				const next = nextFrame(index, frames, settings.loop);
				if (next === index) {
					pause();
					return;
				}
				void show(next).then(() => {
					if (playing) tick();
				});
			},
			previewDelay(seq.delaysMs[index] ?? 33, speed)
		);
	}

	function change(patch: Partial<AnimSettings>): void {
		pause();
		settings = { ...settings, ...patch };
		saved = null;
		if (patch.scale !== undefined || patch.fps !== undefined) void checkVideo();
		void show(clampFrame(index, frames));
	}

	function scrub(e: Event): void {
		pause();
		void show(Number((e.currentTarget as HTMLInputElement).value));
	}

	async function doExport(): Promise<void> {
		if (!session || !size || problem || refusal || !supported(settings.format)) return;
		pause();
		exporting = true;
		error = null;
		saved = null;
		progress = 0;
		abort = new AbortController();
		try {
			const encoder = await createEncoder(settings.format, out.w, out.h, frames, settings.loop, settings.fps);
			const source = clientFrameSource(session.client, size.w, size.h, out.w, out.h);
			const blob = await exportAnimation({
				sequence: seq,
				source,
				encoder,
				signal: abort.signal,
				onProgress: (p) => (progress = p.done / p.total)
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
			saved = name;
			studio.attachAnimation(blob, out.w, out.h); // the next save of this look stores it
			void studio.save(); // an export is deliberate, so the look is kept too
		} catch (e) {
			if ((e as Error).name !== 'AbortError') error = 'The export failed. Try a smaller scale or a shorter duration.';
		} finally {
			exporting = false;
			abort = null;
		}
	}

	function cancelExport(): void {
		abort?.abort();
	}
</script>

<div class="er" role="dialog" aria-modal="true" aria-label="Animate" data-testid="anim-panel">
	<div class="er-card glass" bind:this={card}>
		<div class="head">
			<div>
				<div class="eyebrow">Animate</div>
				<h3>Save the sorting</h3>
			</div>
			<button class="round" type="button" onclick={onclose} aria-label="Close" data-autofocus data-testid="anim-close">
				<X size={17} />
			</button>
		</div>

		{#if loading}
			<p class="sub" data-testid="anim-loading">Setting up a second engine session…</p>
		{:else if error && !session}
			<p class="fail" role="alert" data-testid="anim-error">{error}</p>
			<div class="foot"><button class="btn pri" type="button" onclick={onclose}>Close</button></div>
		{:else}
			<div class="stage">
				<canvas
					bind:this={canvas}
					width={prev.w}
					height={prev.h}
					style="aspect-ratio: {prev.w} / {prev.h}"
					aria-label="Animation preview"
					data-testid="anim-canvas"
				></canvas>
				<div class="transport">
					<button
						class="round"
						type="button"
						onclick={() => (playing ? pause() : play())}
						aria-label={playing ? 'Pause the preview' : 'Play the preview'}
						data-testid="anim-play"
					>
						{#if playing}<Pause size={16} />{:else}<Play size={16} />{/if}
					</button>
					<input
						type="range"
						min="0"
						max={Math.max(0, frames - 1)}
						value={index}
						oninput={scrub}
						aria-label="Frame"
						data-testid="anim-scrub"
					/>
					<div class="chips speeds" role="radiogroup" aria-label="Preview speed">
						{#each PREVIEW_SPEEDS as s (s)}
							<button
								type="button"
								role="radio"
								aria-checked={speed === s}
								class:on={speed === s}
								onclick={() => (speed = s)}>{s}x</button
							>
						{/each}
					</div>
				</div>
			</div>

			<div class="controls">
				<div class="group">
					<span class="eyebrow">Format</span>
					<div class="chips" role="radiogroup" aria-label="Format">
						{#each Object.entries(ANIM_FORMATS) as [id, f] (id)}
							{@const ok = supported(id as AnimFormat)}
							<button
								type="button"
								role="radio"
								aria-checked={settings.format === id}
								class:on={settings.format === id}
								disabled={!ok}
								title={ok ? undefined : `${f.name} is not available in this browser`}
								onclick={() => change({ format: id as AnimFormat })}>{f.name}</button
							>
						{/each}
					</div>
					<p class="sub">{ANIM_FORMATS[settings.format].note}</p>
					{#if video.note}<p class="warn" role="note" data-testid="anim-video-note">{video.note}</p>{/if}
				</div>

				<div class="group">
					<span class="eyebrow">Scale</span>
					<div class="chips">
						{#each ANIM_SCALES as s (s)}
							<button type="button" class:on={settings.scale === s} onclick={() => change({ scale: s })}
								>{Math.round(s * 100)}%</button
							>
						{/each}
					</div>
				</div>

				<div class="group">
					<span class="eyebrow">Duration</span>
					<div class="chips">
						{#each ANIM_DURATIONS as d (d)}
							<button type="button" class:on={settings.durationSec === d} onclick={() => change({ durationSec: d })}
								>{d}s</button
							>
						{/each}
					</div>
				</div>

				<div class="group">
					<span class="eyebrow">Frame rate</span>
					<div class="chips">
						{#each ANIM_FPS as f (f)}
							<button type="button" class:on={settings.fps === f} onclick={() => change({ fps: f })}>{f} fps</button>
						{/each}
					</div>
				</div>

				<div class="group">
					<span class="eyebrow">Pacing</span>
					<div class="chips">
						<button type="button" class:on={settings.ease === 'ease-out'} onclick={() => change({ ease: 'ease-out' })}
							>Ease out</button
						>
						<button type="button" class:on={settings.ease === 'linear'} onclick={() => change({ ease: 'linear' })}
							>Linear</button
						>
					</div>
				</div>

				<div class="group">
					<span class="eyebrow">End hold</span>
					<div class="chips">
						{#each ANIM_HOLDS as h (h)}
							<button type="button" class:on={settings.holdMs === h} onclick={() => change({ holdMs: h })}
								>{h === 0 ? 'None' : h / 1000 + 's'}</button
							>
						{/each}
					</div>
				</div>

				{#if isVideo}
					<p class="sub">Videos loop in the Archive and on shared pages; other players follow their own setting.</p>
				{:else}
					<label class="row">
						<input
							type="checkbox"
							checked={settings.loop}
							onchange={(e) => change({ loop: e.currentTarget.checked })}
						/>
						Loop forever
					</label>
				{/if}
			</div>

			<p class="sub" data-testid="anim-info">
				{out.w}×{out.h} · {fmtMP(out.w * out.h)} · {frames} frames · about {fmtBytes(estimate)} · {name}
			</p>
			{#if warning}<p class="warn" role="note" data-testid="anim-memory">{warning}</p>{/if}
			{#if refusal}<p class="fail" role="alert" data-testid="anim-refusal">{refusal}</p>{/if}
			{#if problem}<p class="warn" role="note">{problem}</p>{/if}
			{#if error}<p class="fail" role="alert" data-testid="anim-error">{error}</p>{/if}
			{#if saved}<p class="good" role="status" data-testid="anim-saved">Saved {saved}. Check your downloads.</p>{/if}

			{#if exporting}
				<div
					class="progress"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(progress * 100)}
				>
					<div style="width: {Math.round(progress * 100)}%"></div>
				</div>
				<p class="sub" data-testid="anim-progress">
					{Math.round(progress * 100)}% · frame {Math.round(progress * frames)} of {frames}
				</p>
			{/if}

			<div class="foot">
				<button class="btn" type="button" onclick={onclose}>Close</button>
				{#if exporting}
					<button class="btn" type="button" onclick={cancelExport} data-testid="anim-cancel">
						<Square size={14} /> Cancel
					</button>
				{:else}
					<button
						class="btn pri"
						type="button"
						disabled={!!problem || !!refusal || loading || !session || !supported(settings.format)}
						onclick={doExport}
						data-testid="anim-export"
					>
						<Download size={15} /> Export {ANIM_FORMATS[settings.format].name}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.er {
		position: fixed;
		inset: 0;
		z-index: 160;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgba(8, 7, 6, 0.8);
		backdrop-filter: blur(10px);
		overflow: auto;
	}
	.er-card {
		width: min(760px, 100%);
		max-height: calc(100vh - 40px);
		overflow: auto;
		padding: 24px 26px 20px;
		display: grid;
		gap: 14px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	h3 {
		font-size: 30px;
		line-height: 1.05;
	}
	.stage {
		display: grid;
		gap: 10px;
		background: rgba(0, 0, 0, 0.28);
		padding: 10px;
		border: 1px solid var(--line);
	}
	canvas {
		display: block;
		width: 100%;
		max-height: 46vh;
		object-fit: contain;
		background: #0b0a09;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.transport input[type='range'] {
		flex: 1;
		min-width: 120px;
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 12px 18px;
	}
	.group {
		display: grid;
		gap: 6px;
		align-content: start;
	}
	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chips button {
		min-height: 32px;
		padding: 0 10px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--dim);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.chips button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.chips button.on {
		color: var(--paper);
		border-color: var(--gold);
		background: rgba(201, 162, 76, 0.12);
	}
	.speeds button {
		min-height: 26px;
		font-size: 10px;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	p {
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.6;
		margin: 0;
	}
	.warn {
		color: var(--paper);
		padding-left: 12px;
		border-left: 2px solid var(--gold);
	}
	.fail {
		color: var(--paper);
		padding-left: 12px;
		border-left: 2px solid var(--ver);
	}
	.good {
		color: var(--paper);
		padding-left: 12px;
		border-left: 2px solid var(--gold);
	}
	.progress {
		height: 4px;
		background: rgba(236, 228, 211, 0.12);
	}
	.progress div {
		height: 100%;
		background: var(--gold);
		transition: width 120ms linear;
	}
	.foot {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	@media (max-width: 700px) {
		.er-card {
			padding: 18px;
		}
		canvas {
			max-height: 34vh;
		}
		.chips button,
		.transport .round {
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.progress div {
			transition: none;
		}
	}
</style>
