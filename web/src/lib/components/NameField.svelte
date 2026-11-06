<script lang="ts">
	// The picture's name: a button that says it, and the little editor that opens in its place. Used under the picture and in
	// the phone sheet's header, so naming never depends on a keyboard shortcut (F2) that a tablet does not have.
	import { Pencil } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';
	import { clean, fileName } from '#lib/naming';
	import { settings } from '#lib/settings.svelte';

	let { from, testid = 'name' }: { from: 'caption' | 'sheet'; testid?: string } = $props();

	const editing = $derived(studio.renameFrom === from);
	const draftFile = $derived(
		fileName(
			clean(studio.nameDraft) || studio.name,
			studio.params.mode,
			settings.exportFormat,
			String(studio.params.seed)
		)
	);
	let cancelled = false;
	let input: HTMLInputElement | undefined = $state();

	function start(): void {
		cancelled = false;
		studio.startRename(from);
	}
	// focus the field when it opens, so a tap on a phone brings the keyboard up
	$effect(() => {
		if (editing) input?.focus();
	});
</script>

{#if editing}
	<div
		class="nm-edit"
		role="group"
		aria-label="Rename"
		onfocusout={(e) => {
			// leaving the whole group saves; moving between its field and buttons does not
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
				if (cancelled) cancelled = false;
				else studio.commitRename();
			}
		}}
	>
		<input
			bind:this={input}
			class="field nm"
			bind:value={studio.nameDraft}
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === 'Enter') studio.commitRename();
				if (e.key === 'Escape') {
					cancelled = true; // Esc undoes: the old name stays
					studio.cancelRename();
				}
			}}
			aria-label="Name"
			data-testid="{testid}-input"
			maxlength="200"
		/>
		<button class="btn sm pri" type="button" onclick={() => studio.commitRename()} data-testid="{testid}-save"
			>Save</button
		>
		<button
			class="btn sm"
			type="button"
			onclick={() => {
				studio.nameDraft = '';
				studio.commitRename();
			}}
			data-testid="{testid}-auto">Auto</button
		>
		<small data-testid="{testid}-file">{draftFile}</small>
	</div>
{:else}
	<button
		class="nm-btn"
		type="button"
		onclick={start}
		data-testid={testid}
		aria-label="Rename “{studio.name}”"
		title="Rename this picture (F2)"><span>{studio.name}</span><Pencil size={14} aria-hidden="true" /></button
	>
{/if}

<style>
	.nm-btn {
		font: inherit;
		color: var(--paper);
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		max-width: 100%;
	}
	.nm-btn span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nm-btn :global(svg) {
		flex: none;
		color: var(--dim);
	}
	.nm-edit {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
		width: 100%;
	}
	.nm-edit small {
		color: var(--dim);
		font-size: 10px;
		font-style: normal;
	}
	.nm {
		width: min(30ch, 100%);
		font-style: italic;
		min-height: 44px;
	}
	.nm-edit :global(.btn) {
		min-height: 44px;
		min-width: 68px;
		padding: 0 16px;
	}
	/* A short screen (a phone on its side) has no room under the picture for a second line: one compact row. */
	@media (max-height: 520px) {
		.nm-edit {
			flex-wrap: nowrap;
		}
		.nm-edit small {
			display: none;
		}
		.nm {
			flex: 1;
			min-width: 0;
			width: auto;
		}
	}
</style>
