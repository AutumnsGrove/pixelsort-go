<script lang="ts">
	import { studio } from '#lib/studio.svelte';
	import {
		CURSORS,
		HANDLES,
		duplicate,
		handlePositions,
		move,
		nudge,
		resize,
		rotate,
		type Handle
	} from '#lib/mask-model';
	import type { MaskObject } from '#lib/regions';

	// The editable outlines of the protected shapes, drawn over the picture: drag to move, corners and sides to resize,
	// the knob to rotate (Shift snaps to 15 degrees), arrows to nudge, Delete to remove. The model is in mask-model.ts.
	let { active }: { active: boolean } = $props();

	const size = $derived(studio.size);
	const sel = $derived(studio.selectedMask);
	let svg: SVGSVGElement | undefined = $state();
	let pending = false;

	/** One sort at a time while dragging; the last position always gets its own sort on release. */
	function live(): void {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			void studio.applyMask();
		});
	}
	function point(e: PointerEvent): [number, number] {
		const r = svg!.getBoundingClientRect();
		return [((e.clientX - r.left) * size!.w) / r.width, ((e.clientY - r.top) * size!.h) / r.height];
	}
	function drag(e: PointerEvent, i: number, kind: 'move' | 'rotate' | 'resize', handle?: Handle): void {
		if (!size) return;
		e.stopPropagation();
		e.preventDefault();
		studio.selectedMask = i;
		const start: MaskObject = { ...studio.maskObjects[i]! };
		const p0 = point(e);
		let moved = false;
		const onMove = (ev: PointerEvent): void => {
			const p = point(ev);
			moved = true;
			studio.maskObjects[i] =
				kind === 'move'
					? move(start, size, p[0] - p0[0], p[1] - p0[1])
					: kind === 'rotate'
						? rotate(start, size, p, ev.shiftKey)
						: resize(start, size, handle!, p, ev.shiftKey);
			live();
		};
		const onUp = (): void => {
			removeEventListener('pointermove', onMove);
			removeEventListener('pointerup', onUp);
			if (moved) void studio.applyMask();
		};
		addEventListener('pointermove', onMove);
		addEventListener('pointerup', onUp);
	}
	function onKey(e: KeyboardEvent): void {
		if (!active || sel === null || !size) return;
		const t = e.target as HTMLElement | null;
		if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
		const o = studio.maskObjects[sel];
		if (!o) return;
		if (e.key === 'Delete' || e.key === 'Backspace') {
			studio.maskObjects.splice(sel, 1);
			studio.selectedMask = null;
		} else if (e.key === 'd' && e.shiftKey) {
			studio.maskObjects.push(duplicate(o));
			studio.selectedMask = studio.maskObjects.length - 1;
		} else {
			const d: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1]
			};
			const v = d[e.key];
			if (!v) return;
			studio.maskObjects[sel] = nudge(o, size, v[0], v[1], e.shiftKey);
		}
		e.preventDefault();
		e.stopPropagation();
		void studio.applyMask();
	}
	const k = $derived(size && svg ? size.w / Math.max(1, svg.clientWidth) : 1); // working px per CSS px
</script>

<svelte:window onkeydowncapture={onKey} />

{#if active && size && studio.maskObjects.length}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={svg}
		class="medit"
		class:off={studio.tool !== 'move'}
		viewBox="0 0 {size.w} {size.h}"
		preserveAspectRatio="none"
		data-testid="mask-handles"
		onpointerdown={() => (studio.selectedMask = null)}
	>
		{#each studio.maskObjects as o, i (i)}
			{@const hw = (o.w * size.w) / 2}
			{@const hh = (o.h * size.h) / 2}
			<g transform="translate({o.cx * size.w} {o.cy * size.h}) rotate({o.rot})">
				{#if o.kind === 'ellipse'}
					<ellipse
						rx={hw}
						ry={hh}
						class="shape"
						class:cut={o.mode === 'cut'}
						class:on={sel === i}
						onpointerdown={(e) => drag(e, i, 'move')}
						data-testid="mask-shape"
					/>
				{:else}
					<rect
						x={-hw}
						y={-hh}
						width={hw * 2}
						height={hh * 2}
						class="shape"
						class:cut={o.mode === 'cut'}
						class:on={sel === i}
						onpointerdown={(e) => drag(e, i, 'move')}
						data-testid="mask-shape"
					/>
				{/if}
			</g>
			{#if sel === i}
				{@const pos = handlePositions(o, size, 20 * k)}
				<line x1={o.cx * size.w} y1={o.cy * size.h} x2={pos.rotate[0]} y2={pos.rotate[1]} class="stem" />
				<circle
					cx={pos.rotate[0]}
					cy={pos.rotate[1]}
					r={6.3 * k}
					class="knob"
					onpointerdown={(e) => drag(e, i, 'rotate')}
					data-testid="mask-rotate"
				/>
				{#each HANDLES as h, hi (hi)}
					<rect
						x={pos.handles[hi]![0] - 5.5 * k}
						y={pos.handles[hi]![1] - 5.5 * k}
						width={11 * k}
						height={11 * k}
						class="handle"
						style:cursor={CURSORS[h.join(',')]}
						transform="rotate({o.rot} {pos.handles[hi]![0]} {pos.handles[hi]![1]})"
						onpointerdown={(e) => drag(e, i, 'resize', h)}
						data-testid="mask-handle"
					/>
				{/each}
			{/if}
		{/each}
	</svg>
{/if}

<style>
	/* While painting or erasing, the brush layer takes the pointer, not the shapes under it. */
	.medit.off {
		pointer-events: none;
	}
	.medit {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		z-index: 6;
	}
	.shape {
		fill: rgba(255, 90, 54, 0.001);
		stroke: rgba(236, 228, 211, 0.7);
		stroke-width: 1.2;
		vector-effect: non-scaling-stroke;
		cursor: move;
	}
	.shape.on {
		stroke: #ece4d3;
		stroke-width: 1.6;
	}
	.shape.cut {
		stroke-dasharray: 5 4;
	}
	.stem {
		stroke: rgba(236, 228, 211, 0.6);
		vector-effect: non-scaling-stroke;
	}
	.knob {
		fill: #ff5a36;
		stroke: #0a0908;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
		cursor: grab;
	}
	.handle {
		fill: #ece4d3;
		stroke: #0a0908;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
</style>
