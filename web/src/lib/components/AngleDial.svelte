<script lang="ts">
	import { fromPointer, snap15, wrap } from '#lib/angle';
	let { value = $bindable(0), onchange }: { value: number; onchange?: () => void } = $props();
	let el: SVGSVGElement | undefined = $state();
	let dragging = false;

	function set(v: number): void {
		value = wrap(v);
		onchange?.();
	}
	function point(e: PointerEvent): void {
		if (!el) return;
		const r = el.getBoundingClientRect();
		const a = fromPointer(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY);
		set(e.shiftKey ? snap15(a) : a);
	}
	function key(e: KeyboardEvent): void {
		const step = e.shiftKey ? 15 : 1;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + step);
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - step);
		else return;
		e.preventDefault();
	}
	const rad = $derived((-value * Math.PI) / 180); // 0 = left to right, 90 = bottom to top
</script>

<div class="dial">
	<svg
		bind:this={el}
		viewBox="-50 -50 100 100"
		role="slider"
		tabindex="0"
		aria-label="Direction"
		aria-valuemin="0"
		aria-valuemax="359"
		aria-valuenow={value}
		onpointerdown={(e) => {
			dragging = true;
			el?.setPointerCapture(e.pointerId);
			point(e);
		}}
		onpointermove={(e) => dragging && point(e)}
		onpointerup={() => (dragging = false)}
		onkeydown={key}
		data-testid="dial"
	>
		<circle r="44" fill="none" stroke="var(--faint)" stroke-width="1.5" />
		{#each [0, 90, 180, 270] as a (a)}
			<line
				x1={38 * Math.cos((-a * Math.PI) / 180)}
				y1={38 * Math.sin((-a * Math.PI) / 180)}
				x2={44 * Math.cos((-a * Math.PI) / 180)}
				y2={44 * Math.sin((-a * Math.PI) / 180)}
				stroke="var(--dim)"
			/>
		{/each}
		<line
			x1="0"
			y1="0"
			x2={36 * Math.cos(rad)}
			y2={36 * Math.sin(rad)}
			stroke="var(--ver)"
			stroke-width="3"
			stroke-linecap="round"
		/>
		<circle
			cx={36 * Math.cos(rad)}
			cy={36 * Math.sin(rad)}
			r="5"
			fill="var(--paper)"
			stroke="var(--ver)"
			stroke-width="3"
		/>
	</svg>
	<label class="deg"
		><input
			type="number"
			class="field"
			min="0"
			max="359"
			{value}
			oninput={(e) => set(Number(e.currentTarget.value) || 0)}
			aria-label="Angle in degrees"
			data-testid="angle-input"
		/>°</label
	>
	<div class="chips">
		{#each [0, 45, 90, 135, 180, 270] as a (a)}<button type="button" class:on={value === a} onclick={() => set(a)}
				>{a}°</button
			>{/each}
	</div>
</div>

<style>
	.dial {
		display: grid;
		gap: 10px;
		justify-items: center;
	}
	svg {
		width: 120px;
		height: 120px;
		cursor: grab;
		touch-action: none;
	}
	.deg {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 90px;
	}
</style>
