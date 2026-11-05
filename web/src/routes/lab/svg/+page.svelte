<script lang="ts">
	import { onMount } from 'svelte';
	import { buildShape, needsTidy } from '#lib/shape-tidy';
	import { parseSvg, readSvg, starterShape, STARTERS } from '#lib/svg-shapes';

	// A harness for web/e2e/svg-shapes.spec.ts: the SVG reader needs a real browser's geometry, so it is exercised here.
	let ready = $state(false);
	onMount(() => {
		Object.assign(globalThis, { svgLab: { buildShape, needsTidy, parseSvg, readSvg, starterShape, STARTERS } });
		ready = true;
	});
</script>

<p data-testid="svg-lab">{ready ? 'ready' : 'loading'}</p>
