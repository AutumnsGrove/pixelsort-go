<script lang="ts">
	// The Archive's full-size look at one run: the picture, its name, the recipe in plain words, and what you can do with it.
	// "Open in Studio" branches from it (the run itself is never changed).
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { X, Star, Trash2, RotateCcw, Share2, Download, ExternalLink } from '@lucide/svelte';
	import RunName from '#components/RunName';
	import { ServerBackend, type ApiRun } from '#lib/api';
	import { recipeSlate } from '#lib/run-recipe';
	import { ENGINE_VERSION } from '#lib/studio.svelte';
	import { fileName } from '#lib/naming';

	let {
		run,
		name,
		inBin,
		canShare,
		parentName,
		onclose,
		onrename,
		onstar,
		ontrash,
		onrestore,
		onshare
	}: {
		run: ApiRun;
		name: string;
		inBin: boolean;
		canShare: boolean;
		/** The parent run's name, when it is still in the Archive. */
		parentName: string | null;
		onclose: () => void;
		onrename: (title: string) => void;
		onstar: () => void;
		ontrash: () => void;
		onrestore: () => void;
		onshare: () => void;
	} = $props();

	const api = new ServerBackend();
	const slate = $derived(recipeSlate(run.settings));
	const when = $derived(
		new Date(run.created_at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
	);
	const otherEngine = $derived(run.engine_version && run.engine_version !== ENGINE_VERSION);
	const ext = $derived(run.result.mime === 'image/jpeg' ? 'jpeg' : run.result.mime === 'image/webp' ? 'webp' : 'png');
	const animExt = $derived(
		run.video?.mime === 'image/gif'
			? 'gif'
			: run.video?.mime === 'video/mp4'
				? 'mp4'
				: run.video?.mime === 'video/webm'
					? 'webm'
					: 'apng'
	);
	const download = $derived(
		fileName(name, String(run.settings.mode ?? 'sort'), ext, String(run.seed)) // the same file name Studio's export gives
	);
	const animDownload = $derived(fileName(name, 'anim', animExt, String(run.seed)));

	let panel: HTMLDivElement | undefined = $state();
	onMount(() => {
		// focus lands inside the dialog, and Tab stays in it while it is open
		panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
	});
	function trap(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
		if (e.key !== 'Tab' || !panel) return;
		const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex="0"]')];
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

<svelte:window onkeydown={trap} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
	class="viewer glass"
	role="dialog"
	aria-modal="true"
	aria-label="{name}, full size"
	bind:this={panel}
	data-testid="viewer"
>
	<header>
		<div class="title">
			<div class="eyebrow">
				{when}{#if parentName}
					· branched from “{parentName}”{:else if run.parent_run_id}
					· branched from another run{/if}
			</div>
			<RunName {name} onsave={onrename} />
		</div>
		<button class="round" type="button" onclick={onclose} aria-label="Close" data-autofocus data-testid="viewer-close"
			><X size={17} /></button
		>
	</header>

	<div class="body">
		{#if run.video?.mime?.startsWith('video/')}
			<video
				class="big"
				src={api.imageUrl(run.video.sha256)}
				aria-label="The animation, {name}"
				controls
				loop
				muted
				playsinline
				autoplay
				data-testid="viewer-video"
			></video>
		{:else if run.video}
			<img
				class="big"
				src={api.imageUrl(run.video.sha256)}
				alt="The animation, {name}"
				data-testid="viewer-animation"
			/>
		{:else}
			<img
				class="big"
				src={api.imageUrl(run.result.sha256)}
				alt="The sorted picture, {name}"
				data-testid="viewer-image"
			/>
		{/if}
		<div class="side">
			<h4 class="eyebrow">Recipe</h4>
			<dl class="slate" data-testid="viewer-slate">
				{#each slate as row (row.label)}<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>{/each}
				<div>
					<dt>Seed</dt>
					<dd>{run.seed}</dd>
				</div>
				<div>
					<dt>Engine</dt>
					<dd>version {run.engine_version}</dd>
				</div>
			</dl>
			{#if otherEngine && !inBin}
				<p class="warn" role="note" data-testid="viewer-engine-note">
					This run was made with engine version {run.engine_version}; this one is {ENGINE_VERSION}, so opening it may
					look different. Saving then makes a new run and leaves this one as it is.
				</p>
			{/if}
			{#if inBin}
				<p class="warn" role="note" data-testid="viewer-bin-note">
					This picture is in the Bin. Restore it to open it in Studio.
				</p>
			{/if}
			<div class="acts">
				{#if inBin}
					<button class="btn pri" type="button" onclick={onrestore} data-testid="viewer-restore"
						><RotateCcw size={16} /> Restore</button
					>
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() base plus a query string -->
					<a class="btn pri" href={resolve('/studio') + '?run=' + run.id} data-testid="viewer-open"
						><ExternalLink size={16} /> Open in Studio</a
					>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an API file, not a route -->
					<a class="btn" href={api.imageUrl(run.result.sha256)} {download} data-testid="viewer-download"
						><Download size={16} /> Download</a
					>
					{#if run.video}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- an API file, not a route -->
						<a
							class="btn"
							href={api.imageUrl(run.video.sha256)}
							download={animDownload}
							data-testid="viewer-anim-download"><Download size={16} /> Animation</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
					{#if canShare}<button class="btn" type="button" onclick={onshare}><Share2 size={16} /> Share</button>{/if}
					<button class="btn" type="button" onclick={onstar} aria-pressed={run.starred}
						><Star size={16} /> {run.starred ? 'Unstar' : 'Star'}</button
					>
					<button class="btn danger" type="button" onclick={ontrash}><Trash2 size={16} /> Move to the bin</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 120;
		background: rgba(5, 4, 3, 0.72);
	}
	.viewer {
		position: fixed;
		z-index: 121;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(1080px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
		padding: 18px 22px 22px;
		display: grid;
		gap: 14px;
		border-radius: 22px;
	}
	header :global(.round) {
		min-width: 44px;
		min-height: 44px;
		flex: none;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 12px;
	}
	.title {
		min-width: 0;
		font-family: var(--serif);
		font-style: italic;
		font-size: 24px;
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(240px, 1fr);
		gap: 22px;
		align-items: start;
	}
	.big {
		width: 100%;
		max-height: 68dvh;
		object-fit: contain;
		background: #000;
		border-radius: 12px;
		box-shadow: 0 0 0 1px var(--faint);
	}
	.side {
		display: grid;
		gap: 12px;
		align-content: start;
	}
	.slate {
		display: grid;
		gap: 0;
		margin: 0;
		font-size: 11.5px;
	}
	.slate div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 0;
		border-top: 1px solid var(--faint2);
	}
	dt {
		color: var(--dim);
	}
	dd {
		margin: 0;
		text-align: right;
	}
	.warn {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid var(--faint);
		border-radius: 12px;
		font-size: 11px;
		line-height: 1.6;
		color: var(--dim);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.acts :global(.btn) {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		text-decoration: none;
	}
	/* A phone: the viewer is the whole screen, picture first, and the actions are within thumb reach. */
	@media (max-width: 700px) {
		.viewer {
			inset: 0;
			left: 0;
			top: 0;
			transform: none;
			width: auto;
			max-height: none;
			border-radius: 0;
			padding: 14px 14px 22px;
		}
		.body {
			grid-template-columns: 1fr;
		}
		.big {
			max-height: 52dvh;
		}
	}
</style>
