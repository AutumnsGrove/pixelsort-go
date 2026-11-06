<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '#components/TopBar';
	import UpdatesBlock from '#components/UpdatesBlock';
	import { settings, updateSettings, resetSettings } from '#lib/settings.svelte';
	import { WORK_RES, DEVICE_RES } from '#lib/settings';
	import { helperEnabled } from '#lib/helper';
	import { onMount } from 'svelte';

	let helperOn = $state<boolean | null>(null); // null while we ask the server
	onMount(() => void helperEnabled().then((on) => (helperOn = on)));
</script>

<svelte:head><title>Settings · pixelsort-go</title></svelte:head>
<TopBar />
<main class="page">
	<h1 class="display">Settings</h1>
	<section class="glass card">
		<h3>Working size</h3>
		<p class="sub">The long edge of the copy that gets sorted. Smaller is faster; exports are made from this copy.</p>
		<div class="chips" role="group" aria-label="Working size">
			<button type="button" class:on={settings.workRes === null} onclick={() => updateSettings({ workRes: null })}
				>Auto ({DEVICE_RES.desktop} / {DEVICE_RES.phone} px)</button
			>
			{#each WORK_RES as r (r)}<button
					type="button"
					class:on={settings.workRes === r}
					onclick={() => updateSettings({ workRes: r })}>{r}</button
				>{/each}
		</div>
	</section>
	<section class="glass card">
		<h3>Export</h3>
		<div class="chips" role="group" aria-label="Format">
			{#each ['png', 'jpeg', 'webp'] as f (f)}<button
					type="button"
					class:on={settings.exportFormat === f}
					onclick={() => updateSettings({ exportFormat: f as 'png' | 'jpeg' | 'webp' })}>{f}</button
				>{/each}
		</div>
		<label
			>Quality {settings.exportQuality}<input
				type="range"
				min="40"
				max="100"
				value={settings.exportQuality}
				oninput={(e) => updateSettings({ exportQuality: Number(e.currentTarget.value) })}
			/></label
		>
		<label class="tog"
			><span><b>Strip metadata</b><small>Remove EXIF (location, camera) from exports.</small></span><input
				type="checkbox"
				checked={settings.stripMeta}
				onchange={(e) => updateSettings({ stripMeta: e.currentTarget.checked })}
			/></label
		>
		<label class="tog"
			><span><b>Embed the recipe</b><small>Store the settings inside the exported file.</small></span><input
				type="checkbox"
				checked={settings.embedRecipe}
				onchange={(e) => updateSettings({ embedRecipe: e.currentTarget.checked })}
			/></label
		>
	</section>
	<section class="glass card" data-testid="helper-settings">
		<h3>Shape helper</h3>
		<p class="sub" data-testid="helper-status">
			{#if helperOn === null}Checking this server…
			{:else if helperOn}“Ask for a shape” is on. It sends a small copy of the picture (at most 512 px, no camera or
				location data) and your request to an AI model on OpenRouter, through this server. Your original is never sent.
			{:else}“Ask for a shape” is not set up on this server, so nothing is ever sent. “Cut out this object” always
				works, on this device.{/if}
		</p>
		{#if helperOn}
			<p class="sub">
				{settings.helperNoticeSeen
					? 'You have seen the notice about what is sent on this device.'
					: 'The notice about what is sent will show before your first request on this device.'}
			</p>
			<button
				type="button"
				class="btn sm"
				disabled={!settings.helperNoticeSeen}
				onclick={() => updateSettings({ helperNoticeSeen: false })}
				data-testid="helper-notice-again">Show the notice again</button
			>
		{/if}
	</section>
	<section class="glass card">
		<h3>Saving</h3>
		<label class="tog"
			><span
				><b>Auto-save runs</b><small
					>Off: nothing goes to the Archive until you press Save (or export). On: a look is stored by itself when a sort
					settles for two seconds, when an animation finishes, and on export.</small
				></span
			><input
				type="checkbox"
				data-testid="autosave"
				checked={settings.autoSave}
				onchange={(e) => updateSettings({ autoSave: e.currentTarget.checked })}
			/></label
		>
	</section>
	<section class="glass card">
		<h3>Look and feel</h3>
		<label class="tog"
			><span><b>Film grain</b></span><input
				type="checkbox"
				data-testid="grain"
				checked={settings.grain}
				onchange={(e) => updateSettings({ grain: e.currentTarget.checked })}
			/></label
		>
		<div class="chips" role="group" aria-label="Motion">
			<button type="button" class:on={settings.motion === 'system'} onclick={() => updateSettings({ motion: 'system' })}
				>Follow system</button
			>
			<button type="button" class:on={settings.motion === 'reduce'} onclick={() => updateSettings({ motion: 'reduce' })}
				>Always reduce motion</button
			>
		</div>
		<label
			>Animation speed {settings.speed} steps/s<input
				type="range"
				min="1"
				max="400"
				value={settings.speed}
				oninput={(e) => updateSettings({ speed: Number(e.currentTarget.value) })}
			/></label
		>
	</section>
	<section class="glass card">
		<h3>Tour</h3>
		<p class="sub">A short walk around Studio.</p>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() base plus a query string -->
		<a class="btn" href={resolve('/studio') + '?tour'} data-testid="take-tour">Take the tour</a>
	</section>
	<UpdatesBlock />
	<button class="btn" type="button" onclick={resetSettings}>Reset to defaults</button>
</main>

<style>
	.page {
		position: relative;
		z-index: 5;
		max-width: 720px;
		margin: 0 auto;
		padding: 110px 24px 80px;
		display: grid;
		gap: 18px;
	}
	h1 {
		font-size: 56px;
	}
	.card {
		padding: 22px 24px;
		display: grid;
		gap: 12px;
	}
	label {
		display: grid;
		gap: 4px;
		font-size: 11px;
		color: var(--dim);
	}
	.tog {
		display: flex;
	}
</style>
