<script lang="ts">
	// The Shape helper's first half: "Cut out this object". Click something in the picture and the engine traces its outline; the
	// result is a preview you accept with "Use it". Nothing is added to the shape library until then, and nothing is sent anywhere.
	import { studio } from '#lib/studio.svelte';
	import { outlinePathD, TOLERANCE } from '#lib/cutout-shape';
	import { helperEnabled, HELPER_PROMPT_MAX } from '#lib/helper';
	import { settings, updateSettings } from '#lib/settings.svelte';
	import { onMount } from 'svelte';

	// ---- Ask: a model on the server picks the object. Off unless the server has it set up. ----
	let enabled = $state(false);
	let prompt = $state('');
	let asking = $state(false); // the first-use notice is showing, waiting for a yes
	let noticeEl = $state<HTMLElement | undefined>();
	$effect(() => {
		// on a phone the notice opens below the fold of the sheet: bring it, and its buttons, into view
		if (asking) noticeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});
	onMount(() => void helperEnabled().then((on) => (enabled = on)));
	const h = $derived(studio.helper);
	const running = $derived(h.status === 'running');
	function ask(): void {
		const text = prompt.trim();
		if (!text || running) return;
		if (!settings.helperNoticeSeen) {
			asking = true;
			return;
		}
		void studio.askHelper(text);
	}
	function confirmAsk(): void {
		updateSettings({ helperNoticeSeen: true });
		asking = false;
		void studio.askHelper(prompt.trim());
	}

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
	{#if enabled}
		<div class="ask" data-testid="helper-ask">
			<label class="lbl" for="helper-prompt"><b>Ask for a shape.</b> Say what to cut out.</label>
			<textarea
				id="helper-prompt"
				class="field prompt"
				rows="2"
				maxlength={HELPER_PROMPT_MAX}
				placeholder="the red car on the left"
				bind:value={prompt}
				disabled={running}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						ask();
					}
				}}
				data-testid="helper-prompt"></textarea>
			<div class="bar">
				{#if running}
					<button type="button" class="btn sm" onclick={() => studio.stopHelper()} data-testid="helper-stop"
						>Stop</button
					>
				{:else}
					<button
						type="button"
						class="btn sm pri"
						disabled={!prompt.trim() || !studio.size}
						onclick={ask}
						data-testid="helper-ask-go">Ask</button
					>
				{/if}
			</div>
			{#if asking}
				<div
					class="notice"
					bind:this={noticeEl}
					role="group"
					aria-label="Before the first request"
					data-testid="helper-notice"
				>
					<p>
						<b>Asking sends something off this device.</b> A small copy of the picture (at most 512 pixels on its long side,
						with no camera or location data) and your request go through this server to an AI model on OpenRouter. Your original
						picture is never sent. You will only see this once; Settings can show it again.
					</p>
					<div class="bar">
						<button type="button" class="btn sm pri" onclick={confirmAsk} data-testid="helper-notice-ok"
							>Send a small copy and ask</button
						>
						<button type="button" class="btn sm" onclick={() => (asking = false)} data-testid="helper-notice-no"
							>Not now</button
						>
					</div>
				</div>
			{/if}
			<div aria-live="polite" data-testid="helper-transcript">
				{#if h.steps.length}
					<ol class="steps">
						{#each h.steps as st (st.id)}
							<li class:bad={st.failed}>
								<span>{st.label}{st.ms === null && running ? '…' : ''}</span>
								{#if st.ms !== null}<small>{st.failed ? 'did not work' : st.ms + ' ms'}</small>{/if}
							</li>
						{/each}
					</ol>
				{/if}
				{#if h.say}<p class="say" data-testid="helper-say">{h.say}</p>{/if}
				{#if h.note}<p class="refusal" data-testid="helper-note">{h.note}</p>{/if}
			</div>
		</div>
	{/if}
	<p class="sub">
		<b>Cut out this object.</b> Click something in the picture and its outline becomes a shape you can use. This part works
		on this device and sends nothing.
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
	.ask {
		display: grid;
		gap: 8px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--faint);
	}
	.lbl {
		font-size: 11px;
		color: var(--dim);
	}
	.prompt {
		width: 100%;
		min-height: 56px;
		resize: vertical;
	}
	.notice {
		display: grid;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--faint);
		border-radius: 12px;
		font-size: 11px;
		line-height: 1.6;
	}
	.notice p,
	.say {
		margin: 0;
	}
	.say {
		font-size: 11px;
		line-height: 1.6;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
		font-size: 11px;
	}
	.steps li {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.steps small {
		color: var(--dim);
	}
	.steps li.bad small {
		color: var(--ver);
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
	.ask .bar :global(.btn.pri),
	.ask .bar :global(.btn:only-child) {
		min-width: 96px;
	}
</style>
