<script lang="ts">
	import { onMount } from 'svelte';
	import { Check } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';

	// The compact protect bar only exists when there is room for it: a phone hides it (the Pro sheet holds the chips), and so
	// does a window too short to spare the row. Closing the sheet there would leave the brush armed with no visible way out —
	// the pointer paints wherever you tap. This pill rides over the bottom of the picture for exactly that case: no bar, no
	// sheet, and a brush tool still on. Where the bar is shown it carries Done, so the pill is not needed.
	let { sheetOpen }: { sheetOpen: boolean } = $props();

	let noBar = $state(false);
	onMount(() => {
		// kept in step with the two places the bar hides itself: ProtectBar's own rule and Studio's stage sizing
		const mq = matchMedia('(max-width: 700px), (max-height: 560px)');
		noBar = mq.matches;
		const on = () => (noBar = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
</script>

{#if noBar && !sheetOpen && studio.tool !== 'move'}
	<button type="button" class="exit" onclick={() => studio.exitTool()} data-testid="brush-exit">
		<Check size={15} />Done painting
	</button>
{/if}

<style>
	.exit {
		position: absolute;
		left: 50%;
		bottom: 10px;
		transform: translateX(-50%);
		z-index: 8;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 0 18px;
		border: 1px solid var(--faint);
		border-radius: 999px;
		background: rgba(24, 20, 18, 0.92);
		backdrop-filter: blur(12px);
		color: var(--paper);
		font-size: 11px;
		letter-spacing: 1.1px;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.exit:hover {
		border-color: var(--dim);
		background: var(--faint2);
	}
</style>
