<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applySettings } from '#lib/settings.svelte';
	let { children } = $props();
	onMount(applySettings);
</script>

<div class="glow"></div>
<div class="grain" aria-hidden="true"></div>
<div class="vig" aria-hidden="true"></div>
{@render children()}
