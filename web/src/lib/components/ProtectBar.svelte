<script lang="ts">
	import { studio } from '#lib/studio.svelte';
	import { MAX_RADIUS, MIN_RADIUS } from '#lib/brush';

	// The compact way to keep using the protect tools when the Pro panel is closed: the panel covers the right side of
	// the picture, so closing it has to leave the brush and the shape handles working. It sits in the flow under the
	// picture, never over it.
	let { onopen }: { onopen: () => void } = $props();

	const radiusPx = $derived(Math.max(1, Math.round(studio.brushRadius * 2 * (studio.size?.w ?? 1000))));
</script>

<div class="protect-bar glass" data-testid="protect-bar" role="toolbar" aria-label="Protect tools">
	<div class="chips" role="group" aria-label="Tool">
		{#each [['move', 'Move'], ['paint', 'Paint'], ['erase', 'Erase']] as [id, label] (id)}
			<button
				type="button"
				class:on={studio.tool === id}
				aria-pressed={studio.tool === id}
				onclick={() => (studio.tool = id as typeof studio.tool)}
				data-testid="bar-tool-{id}">{label}</button
			>
		{/each}
	</div>
	{#if studio.tool !== 'move'}
		<label class="size"
			>Brush <b>{radiusPx} px</b>
			<input
				type="range"
				min={MIN_RADIUS}
				max={MAX_RADIUS}
				step="0.001"
				bind:value={studio.brushRadius}
				aria-label="Brush size"
				data-testid="bar-brush-size"
			/>
		</label>
	{/if}
	{#if studio.maskStrokes.length}
		<span class="count" data-testid="bar-strokes"
			>{studio.maskStrokes.length} {studio.maskStrokes.length === 1 ? 'stroke' : 'strokes'}</span
		>
		<button class="mini" type="button" onclick={() => studio.undoStroke()} data-testid="bar-undo">Undo</button>
		<button class="mini" type="button" onclick={() => studio.clearStrokes()} data-testid="bar-clear-strokes"
			>Clear</button
		>
	{/if}
	<button class="mini pro" type="button" onclick={onopen} aria-label="Open the Pro panel" data-testid="bar-pro"
		>Pro</button
	>
</div>

<style>
	.protect-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 10px;
		justify-self: center;
		width: fit-content;
		max-width: 100%;
		min-height: 44px;
		margin-top: 8px;
		padding: 6px 10px;
		border-radius: 999px;
	}
	.protect-bar .chips {
		gap: 4px;
		flex-wrap: nowrap;
	}
	.protect-bar button {
		min-height: 32px;
	}
	.size {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--dim);
		white-space: nowrap;
	}
	.size b {
		font-family: var(--mono);
		font-weight: 500;
		color: var(--paper);
	}
	.size input {
		width: 96px;
	}
	.count {
		font-size: 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--dim);
		white-space: nowrap;
	}
	.mini {
		min-height: 32px;
		padding: 6px 11px;
		border: 1px solid var(--faint);
		border-radius: 999px;
		font-size: 10px;
		letter-spacing: 1.1px;
		text-transform: uppercase;
		color: var(--dim);
		transition: 0.15s;
	}
	.mini:hover {
		color: var(--paper);
		border-color: var(--dim);
		background: var(--faint2);
	}
	.pro {
		color: var(--paper);
	}
	/* On a phone the Pro panel is a bottom sheet that leaves the picture in view, so the compact bar is not needed. */
	@media (max-width: 700px) {
		.protect-bar {
			display: none;
		}
	}
</style>
