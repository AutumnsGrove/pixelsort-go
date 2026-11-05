<script lang="ts">
	import { X, Trash2 } from '@lucide/svelte';
	import { studio } from '#lib/studio.svelte';
	import { PATTERNS, SHAPES, classCount, describeClass, type ClassRule } from '#lib/regions';
	import { algos, keys } from '#lib/engine/params';
	import { classColor } from '#lib/overlay';

	let { onclose }: { onclose: () => void } = $props();

	const t = $derived(studio.tiling);
	const nClasses = $derived(t ? classCount(t.pattern, t.kinds) : 0);

	function edit(patch: Partial<NonNullable<typeof t>>): void {
		if (!studio.tiling) return;
		Object.assign(studio.tiling, patch);
		void studio.applyRegions();
	}
	function rule(c: number, patch: Record<string, unknown>): void {
		const r: Record<string, unknown> = { ...(studio.classDefs[c] ?? {}), ...patch };
		for (const k of Object.keys(r)) if (r[k] === undefined || r[k] === '') delete r[k];
		studio.classDefs[c] = r as ClassRule;
		void studio.applyRegions();
	}
</script>

<aside class="pro glass" aria-label="Pro panel" data-testid="pro">
	<header>
		<div>
			<div class="eyebrow">Pro</div>
			<h3>Regions &amp; protect</h3>
		</div>
		<button class="round" type="button" onclick={onclose} aria-label="Close the Pro panel"><X size={17} /></button>
	</header>

	<section>
		<h4 class="eyebrow">Cut the picture into</h4>
		<div class="chips" role="group" aria-label="Shape">
			<button type="button" class:on={!t} onclick={() => studio.setTilingShape(null)} data-testid="shape-none"
				>none</button
			>
			{#each SHAPES as s (s)}<button
					type="button"
					class:on={t?.shape === s}
					onclick={() => studio.setTilingShape(s)}
					data-testid="shape-{s}">{s}</button
				>{/each}
		</div>

		{#if t}
			<label
				>size {t.size}
				<input
					type="range"
					min="20"
					max="400"
					value={t.size}
					oninput={(e) => edit({ size: Number(e.currentTarget.value) })}
					aria-label="Cell size"
				/></label
			>
			<label
				>gap {t.gap}
				<input
					type="range"
					min="0"
					max="60"
					value={t.gap}
					oninput={(e) => edit({ gap: Number(e.currentTarget.value) })}
					aria-label="Gap"
				/></label
			>
			<label
				>turn {t.rotate}°
				<input
					type="range"
					min="0"
					max="359"
					value={t.rotate}
					oninput={(e) => edit({ rotate: Number(e.currentTarget.value) })}
					aria-label="Turn the cells"
				/></label
			>
			<div class="chips" role="group" aria-label="Pattern">
				{#each PATTERNS as p (p)}<button type="button" class:on={t.pattern === p} onclick={() => edit({ pattern: p })}
						>{p}</button
					>{/each}
			</div>
			{#if t.pattern === 'random'}<label
					>kinds {t.kinds}
					<input
						type="range"
						min="1"
						max="8"
						value={t.kinds}
						oninput={(e) => edit({ kinds: Number(e.currentTarget.value) })}
						aria-label="Kinds"
					/></label
				>{/if}
			<label class="tog"
				><span><b>Show the cells</b></span><input type="checkbox" bind:checked={studio.showCells} /></label
			>

			<div class="cards">
				{#each Array.from({ length: nClasses }, (_, i) => i + 1) as c (c)}
					{@const r = studio.classDefs[c] ?? {}}
					<div class="card" data-testid="class-{c}">
						<div class="pr-head">
							<i style:background="rgb({classColor(c).join(',')})"></i><b>Kind {c}</b><small>{describeClass(r)}</small>
						</div>
						<label class="row"
							><input
								type="checkbox"
								checked={!!r.frozen}
								onchange={(e) => rule(c, { frozen: e.currentTarget.checked || undefined })}
								aria-label="Freeze kind {c}"
							/> freeze</label
						>
						{#if !r.frozen}
							<label class="row"
								>own angle
								<input
									type="number"
									class="field"
									min="0"
									max="359"
									placeholder="same"
									value={r.angle ?? ''}
									oninput={(e) =>
										rule(c, { angle: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) % 360 })}
									aria-label="Angle for kind {c}"
								/>
							</label>
							<label class="row"
								>sort by
								<select
									class="field"
									value={r.key ?? ''}
									onchange={(e) => rule(c, { key: e.currentTarget.value })}
									aria-label="Sort key for kind {c}"
								>
									<option value="">same</option>{#each keys as k (k)}<option>{k}</option>{/each}
								</select>
							</label>
							<label class="row"
								>watch as
								<select
									class="field"
									value={r.algo ?? ''}
									onchange={(e) => rule(c, { algo: e.currentTarget.value })}
									aria-label="Algorithm for kind {c}"
								>
									<option value="">same</option>{#each algos as a (a)}<option>{a}</option>{/each}
								</select>
							</label>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h4 class="eyebrow">Protect from sorting</h4>
		<div class="chips">
			<button type="button" onclick={() => studio.addMaskObject('ellipse')} data-testid="add-ellipse">+ ellipse</button>
			<button type="button" onclick={() => studio.addMaskObject('rect')}>+ rectangle</button>
			<button type="button" onclick={() => studio.protectBrightestSpot()} data-testid="brightest">brightest spot</button
			>
		</div>
		{#each studio.maskObjects as o, i (i)}
			<div class="obj" data-testid="mask-object">
				<b>{o.kind}</b>
				<button
					type="button"
					class="mini"
					onclick={() => {
						o.mode = o.mode === 'add' ? 'cut' : 'add';
						void studio.applyMask();
					}}>{o.mode === 'add' ? 'protects' : 'punches a hole'}</button
				>
				<label
					>x <input
						type="range"
						min="0"
						max="1"
						step="0.01"
						bind:value={o.cx}
						oninput={() => studio.applyMask()}
						aria-label="Horizontal position"
					/></label
				>
				<label
					>y <input
						type="range"
						min="0"
						max="1"
						step="0.01"
						bind:value={o.cy}
						oninput={() => studio.applyMask()}
						aria-label="Vertical position"
					/></label
				>
				<label
					>size <input
						type="range"
						min="0.05"
						max="1"
						step="0.01"
						bind:value={o.w}
						oninput={() => {
							o.h = o.w * ((studio.size?.w ?? 1) / (studio.size?.h ?? 1));
							void studio.applyMask();
						}}
						aria-label="Size"
					/></label
				>
				<button
					class="round"
					type="button"
					onclick={() => {
						studio.maskObjects.splice(i, 1);
						void studio.applyMask();
					}}
					aria-label="Remove {o.kind}"><Trash2 size={15} /></button
				>
			</div>
		{/each}
		<label class="tog"
			><span><b>Invert</b><small>Sort only inside the protected shapes.</small></span><input
				type="checkbox"
				bind:checked={studio.maskInvert}
				onchange={() => studio.applyMask()}
			/></label
		>
		<label
			>soft edge {Math.round(studio.maskFeather * 100)}%
			<input
				type="range"
				min="0"
				max="0.2"
				step="0.01"
				bind:value={studio.maskFeather}
				oninput={() => studio.applyMask()}
				aria-label="Soft edge"
			/></label
		>
	</section>
</aside>

<style>
	.pro {
		position: fixed;
		right: 14px;
		top: 76px;
		bottom: 120px;
		width: min(380px, calc(100vw - 28px));
		z-index: 45;
		overflow: auto;
		padding: 18px 20px;
		display: grid;
		gap: 18px;
		align-content: start;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: start;
	}
	h3 {
		font-size: 26px;
	}
	section {
		display: grid;
		gap: 10px;
	}
	label {
		display: grid;
		gap: 2px;
		font-size: 11px;
		color: var(--dim);
	}
	.cards {
		display: grid;
		gap: 8px;
	}
	.card {
		border: 1px solid var(--faint);
		border-radius: 14px;
		padding: 10px 12px;
		display: grid;
		gap: 6px;
	}
	.pr-head {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.pr-head i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.pr-head small {
		color: var(--dim);
		margin-left: auto;
		font-size: 10px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row .field {
		width: 90px;
	}
	.obj {
		display: grid;
		gap: 4px;
		padding: 8px 10px;
		border: 1px solid var(--faint);
		border-radius: 12px;
	}
	.mini {
		justify-self: start;
		font-size: 10px;
		letter-spacing: 1px;
		text-transform: uppercase;
		border: 1px solid var(--faint);
		border-radius: 99px;
		padding: 4px 10px;
	}
	.tog {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
</style>
