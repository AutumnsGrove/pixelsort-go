<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applySettings } from '#lib/settings.svelte';
	import { startUpdateDot } from '#lib/updater/state.svelte';
	import StaleTabBanner from '#components/StaleTabBanner';
	let { children } = $props();
	onMount(() => {
		applySettings();
		return startUpdateDot();
	});
</script>

<div class="glow"></div>
<div class="grain" aria-hidden="true"></div>
<div class="vig" aria-hidden="true"></div>
{@render children()}
<StaleTabBanner />
