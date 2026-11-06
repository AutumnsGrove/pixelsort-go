<script lang="ts">
	// A run's name in the Archive, one tap from being edited in place. Enter saves, Esc cancels, leaving the field saves, and an
	// empty name goes back to the automatic one, exactly like naming a picture in Studio.
	import { Pencil } from '@lucide/svelte';
	import { clean } from '#lib/naming';

	let { name, onsave }: { name: string; onsave: (title: string) => void } = $props();

	let editing = $state(false);
	let draft = $state('');
	let cancelled = false;
	let button: HTMLButtonElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();

	function start(): void {
		cancelled = false;
		draft = name;
		editing = true;
	}
	$effect(() => {
		if (editing) {
			input?.focus();
			input?.select();
		}
	});
	function finish(save: boolean): void {
		if (!editing) return;
		editing = false;
		const tidy = clean(draft);
		// unchanged means nothing to say: an automatic name must not turn into a fixed title just because it was opened
		if (save && tidy !== name) onsave(tidy);
		// After the key's own events are done: moving focus at once would let Enter's keypress land on the button and reopen the field.
		setTimeout(() => button?.focus(), 0);
	}
</script>

{#if editing}
	<input
		bind:this={input}
		class="field rn"
		bind:value={draft}
		maxlength="200"
		aria-label="Rename {name}"
		data-testid="run-name-input"
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Enter') finish(true);
			if (e.key === 'Escape') {
				cancelled = true;
				finish(false);
			}
		}}
		onblur={() => {
			if (cancelled) cancelled = false;
			else finish(true);
		}}
	/>
{:else}
	<button
		bind:this={button}
		class="rn-btn"
		type="button"
		onclick={start}
		aria-label="Rename {name}"
		title="Rename"
		data-testid="run-name"><span>{name}</span><Pencil size={13} aria-hidden="true" /></button
	>
{/if}

<style>
	.rn-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		max-width: 100%;
		min-height: 44px;
		text-align: left;
		font: inherit;
		color: inherit;
	}
	.rn-btn span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rn-btn :global(svg) {
		flex: none;
		color: var(--dim);
	}
	.rn {
		width: 100%;
		min-height: 44px;
		font-family: var(--serif);
		font-style: italic;
		font-size: 16px;
	}
</style>
