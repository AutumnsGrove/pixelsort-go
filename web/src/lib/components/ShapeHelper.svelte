<script lang="ts">
	// The Shape helper's first half: "Cut out this object". Click something in the picture and the engine traces its outline; the
	// result is a preview you accept with "Use it". Nothing is added to the shape library until then, and nothing is sent anywhere.
	import { studio } from '#lib/studio.svelte';
	import { outlinePathD, TOLERANCE } from '#lib/cutout-shape';

	let name = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	const c = $derived(studio.cutout);
	const found = $derived(c?.found ?? null);
	$effect(() => {
		if (c?.found) name = c.name; // each new cut-out starts with its own suggested name
	});

	/** The outline fitted into a small preview box, keeping its proportions. */
	const preview = $derived.by(() => {
		if (!found) return null;
		const [x, y, w, h] = found.bbox;
		const k = 78 / Math.max(w, h);
		const d = outlinePathD(
			found.outline.map(([px, py]): [number, number] => [(px - x) * k + x, (py - y) * k + y]),
			[x, y, w * k, h * k]
		);
		return { d, w: Math.round(w * k) + 4, h: Math.round(h * k) + 4 };
	});
	const pct = $derived(found ? (found.area * 100) / found.mask.length : 0);

	function retune(): void {
		// moving the slider re-cuts at the same spot
		clearTimeout(timer);
		if (c) timer = setTimeout(() => void studio.cutOutAt(c.x, c.y), 90);
	}
</script>

<section class="helper" data-testid="helper-section" aria-labelledby="helper-h">
	<h4 class="eyebrow" id="helper-h">Shape helper</h4>
	<p class="sub">
		<b>Cut out this object.</b> Click something in the picture and its outline becomes a shape you can use. Nothing leaves
		this device.
	</p>
	<div class="bar">
		<button
			type="button"
			class="btn sm"
			class:on={studio.picking}
			aria-pressed={studio.picking}
			onclick={() => (studio.picking = !studio.picking)}
			data-testid="helper-pick">{studio.picking ? 'Now click the picture…' : 'Click the picture'}</button
		>
		<button type="button" class="btn sm" onclick={() => void studio.cutOutBrightest()} data-testid="helper-bright"
			>Brightest object</button
		>
		<button
			type="button"
			class="btn sm"
			disabled={!c && !studio.picking}
			onclick={() => studio.clearCutout()}
			data-testid="helper-clear">Clear</button
		>
	</div>
	<label class="tol"
		>Tolerance <em data-testid="helper-tol-v">{studio.cutTol}</em>
		<input
			type="range"
			min={TOLERANCE.min}
			max={TOLERANCE.max}
			bind:value={studio.cutTol}
			oninput={retune}
			aria-label="Tolerance"
			data-testid="helper-tol"
		/></label
	>
	<div aria-live="polite">
		{#if c && c.found === null}
			<p class="refusal" data-testid="helper-refusal">{c.refusal}</p>
		{:else if found && preview}
			<div class="card" data-testid="helper-result">
				<div class="pv">
					<svg
						viewBox="0 0 {preview.w} {preview.h}"
						width={preview.w}
						height={preview.h}
						role="img"
						aria-label="Preview of the cut-out shape"
					>
						<path d={preview.d} />
					</svg>
					<div>
						<input
							class="field nm"
							bind:value={name}
							maxlength="60"
							aria-label="Shape name"
							data-testid="helper-name"
						/>
						<p class="info" data-testid="helper-info">
							{found.outline.length} points (from {found.pointsBefore}) · {pct < 1 ? '<1' : pct.toFixed(1)}% of the
							picture
						</p>
					</div>
				</div>
				<div class="bar">
					<button type="button" class="btn sm pri" onclick={() => studio.useCutout(name)} data-testid="helper-use"
						>Use it</button
					>
					<button type="button" class="btn sm" onclick={() => studio.clearCutout()}>Discard</button>
				</div>
				<p class="info">Nothing is added to your shapes until you press Use it.</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.helper {
		display: grid;
		gap: 10px;
	}
	.sub {
		margin: 0;
		font-size: 11px;
		color: var(--dim);
		line-height: 1.6;
	}
	.bar {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.bar .btn.on {
		background: var(--ver);
		color: #1a0d08;
		border-color: var(--ver);
	}
	.tol {
		display: grid;
		gap: 4px;
		font-size: 11px;
	}
	.tol em {
		font-style: normal;
		color: var(--dim);
	}
	.refusal {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid rgba(255, 90, 54, 0.45);
		background: rgba(255, 90, 54, 0.07);
		border-radius: 12px;
		font-size: 11px;
		line-height: 1.6;
	}
	.card {
		display: grid;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--faint);
		border-radius: 14px;
	}
	.pv {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		align-items: center;
	}
	.pv svg {
		background: repeating-conic-gradient(#1a1714 0 25%, #0d0b0a 0 50%) 50% / 14px 14px;
		border-radius: 8px;
		max-width: 96px;
		height: auto;
	}
	.pv path {
		fill: rgba(255, 90, 54, 0.85);
		stroke: var(--paper);
		stroke-width: 1.2;
	}
	.nm {
		width: 100%;
		font-style: italic;
		min-height: 44px;
	}
	.info {
		margin: 4px 0 0;
		font-size: 10.5px;
		color: var(--dim);
	}
	.bar :global(.btn) {
		min-height: 44px;
	}
</style>
