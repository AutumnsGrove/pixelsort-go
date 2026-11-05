<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { markSeen, placeCard, STEPS } from '#lib/tour';

	let { ondone }: { ondone: () => void } = $props();

	let i = $state(0);
	let card: HTMLDivElement | undefined = $state();
	let pos = $state({ left: 12, top: 12 });
	let hole = $state<{ left: number; top: number; width: number; height: number } | null>(null);
	const step = $derived(STEPS[i]!);

	async function place(): Promise<void> {
		await tick();
		const el = document.querySelector(step.target);
		const r = el?.getBoundingClientRect();
		hole = r && r.width > 0 ? { left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 } : null;
		const c = card?.getBoundingClientRect();
		pos = placeCard(
			hole,
			{ width: c?.width ?? 320, height: c?.height ?? 160 },
			{ width: innerWidth, height: innerHeight }
		);
	}
	function finish(): void {
		markSeen();
		ondone();
	}
	function next(): void {
		if (i + 1 >= STEPS.length) finish();
		else i++;
	}
	function onKey(e: KeyboardEvent): void {
		// the tour owns the keyboard: nothing behind it reacts
		if (e.key === 'Escape') finish();
		else if (e.key === 'Enter' || e.key === 'ArrowRight') next();
		else if (e.key === 'ArrowLeft' && i > 0) i--;
		e.stopPropagation(); // every other key is swallowed too, except Tab so focus can move between the buttons
		if (e.key !== 'Tab') e.preventDefault();
	}
	$effect(() => {
		void i;
		void place();
	});
	onMount(() => {
		addEventListener('keydown', onKey, true);
		addEventListener('resize', place);
		card?.querySelector('button')?.focus();
		return () => {
			removeEventListener('keydown', onKey, true);
			removeEventListener('resize', place);
		};
	});
</script>

<div class="root" role="dialog" aria-modal="true" aria-label="Tour" data-testid="tour">
	{#if hole}<i
			class="hole"
			style:left="{hole.left}px"
			style:top="{hole.top}px"
			style:width="{hole.width}px"
			style:height="{hole.height}px"
		></i>{/if}
	<div class="card glass" bind:this={card} style:left="{pos.left}px" style:top="{pos.top}px">
		<div class="eyebrow">{i + 1} of {STEPS.length}</div>
		<h3>{step.title}</h3>
		<p>{step.body}</p>
		<div class="foot">
			<button class="btn" type="button" onclick={finish} data-testid="tour-skip">Skip</button>
			<button class="btn pri" type="button" onclick={next} data-testid="tour-next"
				>{i + 1 >= STEPS.length ? 'Done' : 'Next'}</button
			>
		</div>
	</div>
</div>

<style>
	.root {
		position: fixed;
		inset: 0;
		z-index: 300;
	}
	.hole {
		position: fixed;
		border-radius: 14px;
		box-shadow: 0 0 0 9999px rgba(8, 7, 6, 0.74);
		outline: 2px solid var(--ver);
		pointer-events: none;
		transition: all 0.2s;
	}
	.card {
		position: fixed;
		width: min(320px, calc(100vw - 24px));
		padding: 16px 18px;
		display: grid;
		gap: 8px;
	}
	h3 {
		font-size: 26px;
		line-height: 1.05;
		margin: 0;
	}
	p {
		margin: 0;
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.7;
	}
	.foot {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
</style>
