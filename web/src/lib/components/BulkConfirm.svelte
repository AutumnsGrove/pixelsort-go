<script lang="ts">
	import { onMount } from 'svelte';

	// One confirmation for a whole batch: the count in the title, the shared and starred warnings said once, and a
	// separate button for the destructive answer. The page passes the exact ids it is about to act on.
	let {
		title,
		lines,
		confirmLabel,
		danger = false,
		busy = false,
		onconfirm,
		oncancel
	}: {
		title: string;
		lines: string[];
		confirmLabel: string;
		danger?: boolean;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let panel: HTMLDivElement | undefined = $state();

	onMount(() => {
		panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
	});

	function key(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.stopPropagation();
			if (!busy) oncancel();
			return;
		}
		if (e.key !== 'Tab' || !panel) return;
		const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled])')];
		if (items.length === 0) return;
		const first = items[0]!;
		const last = items[items.length - 1]!;
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={key} />

<div class="scrim" role="presentation" onclick={() => !busy && oncancel()}></div>
<div
	class="dialog glass"
	role="alertdialog"
	aria-modal="true"
	aria-label={title}
	bind:this={panel}
	data-testid="bulk-confirm"
>
	<h3>{title}</h3>
	{#each lines as line (line)}
		<p>{line}</p>
	{/each}
	<div class="foot">
		<button class="btn" type="button" onclick={oncancel} data-autofocus data-testid="bulk-confirm-cancel">Cancel</button
		>
		<button
			class="btn {danger ? 'danger' : 'pri'}"
			type="button"
			disabled={busy}
			onclick={onconfirm}
			data-testid="bulk-confirm-yes">{busy ? 'Working…' : confirmLabel}</button
		>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: rgba(8, 7, 6, 0.8);
		backdrop-filter: blur(10px);
	}
	.dialog {
		position: fixed;
		inset: 0;
		z-index: 151;
		margin: auto;
		width: min(520px, calc(100vw - 40px));
		height: fit-content;
		max-height: calc(100dvh - 40px);
		overflow: auto;
		padding: 26px 28px 22px;
		display: grid;
		gap: 12px;
	}
	h3 {
		font-size: 32px;
		line-height: 1.05;
	}
	p {
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.7;
	}
	.foot {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		margin-top: 6px;
	}
	@media (max-width: 700px) {
		.dialog {
			padding: 22px 18px 18px;
		}
		h3 {
			font-size: 26px;
		}
		.foot {
			flex-wrap: wrap;
		}
		.foot .btn {
			min-height: 44px;
		}
	}
</style>
