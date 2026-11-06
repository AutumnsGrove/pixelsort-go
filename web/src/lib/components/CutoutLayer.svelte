<script lang="ts">
	// Over the picture: catches the click for "Cut out this object", and draws the region it found as a tint with marching ants
	// round the edge. It never touches the picture; the engine did the finding.
	import { onDestroy } from 'svelte';
	import { studio } from '#lib/studio.svelte';

	let tint: HTMLCanvasElement | undefined = $state();
	let ants: HTMLCanvasElement | undefined = $state();
	let layer: HTMLDivElement | undefined = $state();
	let raf = 0;
	let edge: Int32Array = new Int32Array(0);

	const found = $derived(studio.cutout?.found ?? null);
	const size = $derived(studio.size);

	// The tint is drawn once per region; the edge pixels are listed once, so each animation frame only draws a few thousand dots.
	$effect(() => {
		cancelAnimationFrame(raf);
		const g = tint?.getContext('2d');
		const a = ants?.getContext('2d');
		if (!g || !a || !size) return;
		g.clearRect(0, 0, size.w, size.h);
		a.clearRect(0, 0, size.w, size.h);
		if (!found) return;
		const { w } = found;
		const m = found.mask;
		const h = m.length / w;
		const img = g.createImageData(w, h);
		const list: number[] = [];
		for (let i = 0; i < m.length; i++) {
			if (!m[i]) continue;
			const x = i % w;
			const y = (i / w) | 0;
			const edgy = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w];
			if (edgy) list.push(i);
			else {
				const p = i * 4;
				img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
				img.data[p + 3] = 46;
			}
		}
		g.putImageData(img, 0, 0);
		edge = Int32Array.from(list);
		const still =
			document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
		const dot = Math.max(1, Math.round(w / 640)); // keeps the line a visible width on a big picture
		const draw = (t: number): void => {
			const phase = Math.floor(t / 90) % 8;
			a.clearRect(0, 0, w, h);
			for (const i of edge) {
				const x = i % w;
				const y = (i / w) | 0;
				a.fillStyle = (x + y + phase) % 8 < 4 ? '#ffffff' : '#0a0908';
				a.fillRect(x, y, dot, dot);
			}
			if (!still) raf = requestAnimationFrame(draw);
		};
		draw(0);
		if (!still) raf = requestAnimationFrame(draw);
	});
	onDestroy(() => cancelAnimationFrame(raf));

	function click(e: PointerEvent): void {
		if (!studio.picking || !layer) return;
		e.preventDefault();
		e.stopPropagation();
		const r = layer.getBoundingClientRect();
		studio.picking = false;
		void studio.cutOutAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && studio.picking) studio.picking = false;
	}}
/>

<div
	bind:this={layer}
	class="layer"
	class:pick={studio.picking}
	onpointerdown={click}
	role="presentation"
	data-testid="cutout-layer"
>
	<canvas bind:this={tint} width={size?.w ?? 1} height={size?.h ?? 1} aria-hidden="true"></canvas>
	<canvas bind:this={ants} width={size?.w ?? 1} height={size?.h ?? 1} aria-hidden="true" data-testid="cutout-ants"
	></canvas>
</div>

<style>
	.layer {
		position: absolute;
		inset: 0;
		z-index: 30;
		pointer-events: none;
	}
	.layer.pick {
		pointer-events: auto;
		cursor: crosshair;
		outline: 2px dashed var(--ver);
		outline-offset: -2px;
		touch-action: none;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
