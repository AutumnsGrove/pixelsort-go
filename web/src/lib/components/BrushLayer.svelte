<script lang="ts">
	import { studio } from '#lib/studio.svelte';
	import { addPoint, finishStroke, strokePoints, toFraction } from '#lib/brush';

	// Paint over the picture to protect pixels from sorting, or erase to give them back. Strokes are stored as vectors
	// (fractions of the picture), so the preview and a full-size export agree. Only listens while the Pro panel is open and
	// the tool is Paint or Erase; with Move the shapes' own handles take the pointer instead.
	let { active }: { active: boolean } = $props();

	const size = $derived(studio.size);
	const on = $derived(active && studio.tool !== 'move' && !!size);
	let svg: SVGSVGElement | undefined = $state();
	let live = $state<[number, number][] | null>(null);
	let pointer = $state<[number, number] | null>(null);

	function at(e: PointerEvent): [number, number] {
		const r = svg!.getBoundingClientRect();
		return toFraction(((e.clientX - r.left) * size!.w) / r.width, ((e.clientY - r.top) * size!.h) / r.height, size!);
	}
	function down(e: PointerEvent): void {
		if (!size || e.button > 0) return;
		e.preventDefault();
		svg!.setPointerCapture(e.pointerId);
		studio.suggestion = null;
		live = [at(e)];
	}
	function move(e: PointerEvent): void {
		pointer = at(e);
		if (live && size) live = addPoint(live, at(e), size);
	}
	function up(): void {
		if (!live) return;
		const stroke = finishStroke(live, studio.brushRadius, studio.tool === 'erase');
		live = null;
		if (stroke) studio.addStroke(stroke);
	}
</script>

{#if active && size && (on || studio.maskStrokes.length)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={svg}
		class="brush"
		class:on
		viewBox="0 0 {size.w} {size.h}"
		preserveAspectRatio="none"
		data-testid="brush-layer"
		data-tool={studio.tool}
		onpointerdown={on ? down : undefined}
		onpointermove={on ? move : undefined}
		onpointerup={on ? up : undefined}
		onpointercancel={on ? up : undefined}
		onpointerleave={() => (pointer = null)}
	>
		{#each studio.maskStrokes as s, i (i)}
			<polyline
				class="stroke"
				class:erase={s.erase}
				points={strokePoints(s.points, size)}
				stroke-width={s.radius * 2 * size.w}
				data-testid="stroke"
			/>
		{/each}
		{#if live}
			<polyline
				class="stroke live"
				class:erase={studio.tool === 'erase'}
				points={strokePoints(live, size)}
				stroke-width={studio.brushRadius * 2 * size.w}
			/>
		{/if}
		{#if on && pointer}
			<circle class="cursor" cx={pointer[0] * size.w} cy={pointer[1] * size.h} r={studio.brushRadius * size.w} />
		{/if}
	</svg>
{/if}

<style>
	.brush {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 5;
		pointer-events: none;
		touch-action: none;
	}
	.brush.on {
		pointer-events: auto;
		cursor: crosshair;
	}
	.stroke {
		fill: none;
		stroke: rgba(255, 90, 54, 0.32);
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.stroke.erase {
		stroke: rgba(236, 228, 211, 0.18);
		stroke-dasharray: 2 6;
	}
	.stroke.live {
		stroke: rgba(255, 90, 54, 0.5);
	}
	.stroke.live.erase {
		stroke: rgba(236, 228, 211, 0.3);
	}
	.cursor {
		fill: none;
		stroke: #ece4d3;
		stroke-width: 1.2;
		vector-effect: non-scaling-stroke;
	}
</style>
