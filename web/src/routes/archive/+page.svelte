<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Star, Trash2, RotateCcw, Share2 } from '@lucide/svelte';
	import TopBar from '#components/TopBar';
	import Albums from '#components/Albums';
	import BulkConfirm from '#components/BulkConfirm';
	import ShareDialog from '#components/ShareDialog';
	import RunName from '#components/RunName';
	import RunViewer from '#components/RunViewer';
	import { ShareBackend, sharedRunIDs, type Features } from '#lib/share';
	import { add, dropHidden, range as pickRange, selectAll, summarize, toggle } from '#lib/selection';
	import { ServerBackend, type ApiRun, type Usage } from '#lib/api';
	import { agoText, ageInDays, filter, groupLabel, type RunItem } from '#lib/runs-data';
	import { status, usage as usageLevel } from '#lib/states';
	import { suggest } from '#lib/naming';
	import { describe } from '#lib/errors';
	import { saveFailureReason } from '#lib/save-policy';

	const api = new ServerBackend();
	const shares = new ShareBackend();
	let tab = $state<'all' | 'starred' | 'trash' | 'albums'>('all');
	let features = $state<Features>({ share: false, fetch: false });
	let sharing = $state<ApiRun[] | null>(null);
	let q = $state('');
	let runs = $state<ApiRun[]>([]);
	let usage = $state<Usage | null>(null);
	let loaded = $state(false);
	let offline = $state(false);
	let confirmEmpty = $state(false);

	// ---- selecting several pictures, for the bulk actions ----
	let selectMode = $state(false);
	let picked = $state<Set<number>>(new Set());
	let anchor = $state<number | null>(null);
	let pending = $state<ConfirmAsk | null>(null);
	let bulkBusy = $state(false);
	let bulkNotice = $state<{ tone: 'warn' | 'error'; text: string } | null>(null);
	let suppressClick = false; // a click that ends a drag selects nothing further

	type ConfirmKind = 'trash' | 'restore' | 'delete';
	type ConfirmAsk = {
		kind: ConfirmKind;
		ids: number[];
		title: string;
		lines: string[];
		confirmLabel: string;
		danger: boolean;
	};

	async function load(): Promise<void> {
		try {
			runs = await api.allRuns({ trashed: tab === 'trash' ? '1' : '0' });
			usage = await api.usage();
			offline = false;
		} catch {
			offline = true;
		}
		loaded = true;
	}
	onMount(() => {
		void shares.features().then((f) => (features = f));
		return void load();
	});
	$effect(() => {
		void tab;
		clearPick();
		void load();
	});

	const now = new Date();
	const nameOf = (r: ApiRun) => r.title ?? suggest(r.settings as { mode?: string }, r.seed);
	const items = $derived<RunItem[]>(
		runs.map((r) => ({
			id: r.id,
			name: nameOf(r),
			p: r.settings as RunItem['p'],
			age: ageInDays(r.created_at, now),
			starred: r.starred,
			bytes: r.result.bytes,
			animated: !!r.video
		}))
	);
	const shown = $derived(filter(items, { q, starred: tab === 'starred' }));
	const groups = $derived.by(() => {
		const out: { label: string; items: RunItem[] }[] = [];
		for (const it of shown) {
			const label = groupLabel(it.age, now);
			if (out.at(-1)?.label !== label) out.push({ label, items: [] });
			out.at(-1)!.items.push(it);
		}
		return out;
	});
	const visibleIds = $derived(shown.map((it) => it.id));
	$effect(() => {
		// a search or a reload can hide a picked picture; never act on what the person cannot see
		const next = dropHidden(picked, visibleIds);
		if (next !== picked) picked = next;
	});
	// ---- the viewer: a card opens the run full size; Esc or Close puts focus back on the card ----
	let viewing = $state<number | null>(null);
	let opener: HTMLElement | null = null;
	const viewed = $derived(runs.find((r) => r.id === viewing) ?? null);
	function openViewer(id: number, from: HTMLElement): void {
		opener = from;
		viewing = id;
	}
	function closeViewer(): void {
		viewing = null;
		queueMicrotask(() => opener?.focus());
	}

	// ---- renaming: the new name shows at once; if the server refuses, the old one comes back and the person is told ----
	let failure = $state<ReturnType<typeof describe> | null>(null);
	let retry: (() => void) | null = null;
	async function rename(id: number, title: string): Promise<void> {
		const before = runs.find((r) => r.id === id)?.title ?? null;
		runs = runs.map((r) => (r.id === id ? { ...r, title: title || null } : r));
		try {
			const saved = await api.patchRun(id, { title }); // an empty title clears it: the automatic name comes back
			if (saved && 'title' in saved) runs = runs.map((r) => (r.id === id ? { ...r, title: saved.title } : r));
		} catch (e) {
			runs = runs.map((r) => (r.id === id ? { ...r, title: before } : r));
			failure = describe('save-failed', { reason: saveFailureReason(e) });
			retry = () => void rename(id, title);
		}
	}
	const thumb = (id: number) => api.imageUrl(runs.find((r) => r.id === id)?.thumb.sha256 ?? '');

	async function star(it: RunItem): Promise<void> {
		await api.patchRun(it.id, { starred: !it.starred });
		await load();
	}

	// ---- selection: click, Shift/Ctrl/Cmd, drag, keyboard, and the bar that appears with a count ----
	function clearPick(): void {
		picked = new Set();
		anchor = null;
		selectMode = false;
	}
	function toggleSelectMode(): void {
		if (selectMode) clearPick();
		else {
			selectMode = true;
			bulkNotice = null;
		}
	}
	function selectEverything(): void {
		picked = selectAll(visibleIds);
		selectMode = true;
		anchor = null;
	}
	function pickOne(id: number, on: boolean): void {
		selectMode = true;
		picked = on ? add(picked, id) : toggle(picked, id);
		anchor = id;
	}
	function cardClick(e: MouseEvent, it: RunItem): void {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		if (selectMode || e.shiftKey || e.metaKey || e.ctrlKey) {
			selectMode = true;
			if (e.shiftKey && anchor !== null) {
				picked = pickRange(visibleIds, picked, anchor, it.id, e.metaKey || e.ctrlKey);
			} else {
				picked = toggle(picked, it.id);
				anchor = it.id;
			}
			return;
		}
		openViewer(it.id, e.currentTarget as HTMLElement);
	}

	// Drag across cards. The window listener is used instead of pointerenter so the range keeps working when the
	// pointer passes over a caption, an action button or the gap between cards.
	let dragging = false;
	let dragAnchor: number | null = null;
	let dragMoved = false;
	let hoverId: number | null = null;
	function dragMove(e: PointerEvent): void {
		if (!dragging) return;
		const card = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
			'[data-run-id]'
		);
		const raw = card?.dataset.runId;
		const id = raw ? Number(raw) : null;
		if (id === null || id === hoverId) return;
		hoverId = id;
		if (dragAnchor === null || id === dragAnchor) return;
		dragMoved = true;
		e.preventDefault();
		picked = pickRange(visibleIds, picked, dragAnchor, id);
	}
	function startDrag(e: PointerEvent, it: RunItem): void {
		if (!selectMode || e.button !== 0) return;
		suppressClick = false;
		dragging = true;
		dragAnchor = it.id;
		dragMoved = false;
		hoverId = it.id;
		addEventListener('pointermove', dragMove);
	}
	function endDrag(): void {
		if (!dragging) return;
		removeEventListener('pointermove', dragMove);
		dragging = false;
		dragAnchor = null;
		hoverId = null;
		if (dragMoved) {
			// the click that follows a drag must not toggle the last card as well
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
		}
		dragMoved = false;
	}
	function onKeys(e: KeyboardEvent): void {
		if (viewing !== null || sharing || pending) return;
		const target = e.target as HTMLElement | null;
		if (target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable)) return;
		if (e.key === 'Escape' && (picked.size || selectMode)) {
			e.preventDefault();
			clearPick();
			return;
		}
		if (tab === 'albums') return;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			selectEverything();
		}
	}

	// ---- bulk actions: one confirmation for the whole batch, with the shared and starred warnings said once ----
	function namesFor(ids: number[]): string[] {
		return ids.map((id) => {
			const run = runs.find((r) => r.id === id);
			return run ? nameOf(run) : String(id);
		});
	}
	async function sharedAmong(ids: number[]): Promise<Set<number>> {
		if (!features.share || !ids.length) return new Set();
		try {
			return sharedRunIDs(await shares.list(), Math.floor(Date.now() / 1000));
		} catch {
			return new Set(); // an unreachable share list must not block moving to the bin
		}
	}
	function makeAsk(kind: ConfirmKind, ids: number[], shared: ReadonlySet<number>): ConfirmAsk {
		const counts = summarize(new Set(ids), runs, shared);
		const names = namesFor(ids);
		const one = ids.length === 1;
		const what = one ? `“${names[0] ?? 'this picture'}”` : `${ids.length} pictures`;
		const lines: string[] = [];
		if (kind === 'trash') lines.push(one ? 'You can restore it from the bin.' : 'You can restore them from the bin.');
		else if (kind === 'restore') lines.push(one ? 'It goes back to the Archive.' : 'They go back to the Archive.');
		else lines.push('This cannot be undone.');
		if (counts.shared)
			lines.push(
				`${counts.shared} ${counts.shared === 1 ? 'picture is' : 'pictures are'} in a shared link. The shared ${
					counts.shared === 1 ? 'copy stays' : 'copies stay'
				} up until you revoke ${counts.shared === 1 ? 'it' : 'them'} in Albums.`
			);
		if (kind !== 'restore' && counts.starred)
			lines.push(`${counts.starred} ${counts.starred === 1 ? 'picture is' : 'pictures are'} starred.`);
		return {
			kind,
			ids,
			title:
				kind === 'trash'
					? `Move ${what} to the bin?`
					: kind === 'restore'
						? `Restore ${what}?`
						: `Delete ${what} forever?`,
			lines,
			confirmLabel: kind === 'trash' ? 'Move to the bin' : kind === 'restore' ? 'Restore' : 'Delete forever',
			danger: kind !== 'restore'
		};
	}
	async function askBulk(kind: ConfirmKind, only?: number[]): Promise<void> {
		const ids = only ?? runs.filter((r) => picked.has(r.id)).map((r) => r.id);
		if (!ids.length) return;
		const shared = kind === 'trash' ? await sharedAmong(ids) : new Set<number>();
		pending = makeAsk(kind, ids, shared);
	}
	function settleSelection(ask: ConfirmAsk, missing: number[]): void {
		const failed = missing.filter((id) => ask.ids.includes(id));
		if (!failed.length) {
			clearPick();
			bulkNotice = null;
			return;
		}
		picked = new Set(failed);
		selectMode = true;
		anchor = null;
		const names = namesFor(failed);
		bulkNotice = {
			tone: 'warn',
			text: `${failed.length} of ${ask.ids.length} could not be changed: ${names.join(', ')}. ${
				failed.length === 1 ? 'It is' : 'They are'
			} still selected.`
		};
	}
	async function runBulk(): Promise<void> {
		const ask = pending;
		if (!ask || bulkBusy) return;
		bulkBusy = true;
		bulkNotice = null;
		try {
			let missing: number[] = [];
			if (ask.kind === 'trash') missing = (await api.trash(ask.ids, true)).missing ?? [];
			else if (ask.kind === 'delete') missing = (await api.deleteForever(ask.ids)).missing ?? [];
			else await api.restore(ask.ids);
			pending = null;
			settleSelection(ask, missing);
			await load();
		} catch {
			pending = null;
			bulkNotice = {
				tone: 'error',
				text: `The server couldn’t finish that. ${
					ask.ids.length === 1 ? 'The picture is' : `All ${ask.ids.length} pictures are`
				} still selected; nothing else changed.`
			};
		} finally {
			bulkBusy = false;
		}
	}
	function sharePicked(): void {
		const list = runs.filter((r) => picked.has(r.id));
		if (list.length) sharing = list;
	}

	async function restore(it: RunItem): Promise<void> {
		await api.restore([it.id]);
		await load();
	}
	async function empty(): Promise<void> {
		await api.emptyTrash();
		confirmEmpty = false;
		clearPick();
		await load();
	}
	const gb = (b: number) => b / 2 ** 30; // the budget is configured in GiB
	const banner = $derived(
		usage || offline
			? status(
					{ used: usage ? gb(usage.used_bytes) : 0, budget: usage ? gb(usage.budget_bytes) : 50, offline },
					{ surface: 'archive' }
				)
			: null
	);
	const level = $derived(usage ? usageLevel(gb(usage.used_bytes), gb(usage.budget_bytes)).level : null);
</script>

<svelte:head><title>Archive · pixelsort-go</title></svelte:head>
<svelte:window onkeydown={onKeys} onpointerup={endDrag} onpointercancel={endDrag} />
<TopBar />
<main class="page" class:picking={selectMode || picked.size > 0} class:selected={picked.size > 0}>
	<h1 class="display">Archive</h1>
	{#if banner}
		<div class="glass banner {banner.kind}" role="status">
			<b>{banner.text}</b> <span>{banner.sub}</span><button class="btn sm" type="button" onclick={load}
				>{banner.action === 'Retry' ? 'Retry' : 'OK'}</button
			>
		</div>
	{/if}
	{#if bulkNotice}
		<div
			class="glass banner"
			class:full={bulkNotice.tone === 'error'}
			role={bulkNotice.tone === 'error' ? 'alert' : 'status'}
			data-testid="bulk-notice"
		>
			<b>{bulkNotice.tone === 'error' ? 'Couldn’t finish.' : 'Some were left behind.'}</b>
			<span>{bulkNotice.text}</span>
			<button class="btn sm" type="button" onclick={() => (bulkNotice = null)}>Dismiss</button>
		</div>
	{/if}
	<div class="bar">
		<div class="chips" role="tablist">
			{#each features.share ? ['all', 'starred', 'trash', 'albums'] : ['all', 'starred', 'trash'] as t (t)}<button
					type="button"
					role="tab"
					aria-selected={tab === t}
					class:on={tab === t}
					onclick={() => (tab = t as typeof tab)}>{t}</button
				>{/each}
		</div>
		<input
			class="field search"
			type="search"
			placeholder="Search names and recipes"
			bind:value={q}
			aria-label="Search"
		/>
		{#if tab !== 'albums' && (shown.length || selectMode)}
			<button
				class="btn sm"
				type="button"
				class:pri={selectMode}
				aria-pressed={selectMode}
				onclick={toggleSelectMode}
				data-testid="select-toggle">{selectMode ? 'Cancel' : 'Select'}</button
			>
			{#if selectMode}
				<button class="btn sm" type="button" onclick={selectEverything} data-testid="select-all">Select all</button>
			{/if}
		{/if}
		{#if usage}<span class="eyebrow" data-testid="usage"
				>{gb(usage.used_bytes).toFixed(2)} of {gb(usage.budget_bytes).toFixed(0)} GB{level && level !== 'ok'
					? ' · ' + level
					: ''}</span
			>{/if}
		{#if tab === 'trash' && runs.length}
			{#if confirmEmpty}<button class="btn danger sm" type="button" onclick={empty} data-testid="empty-yes"
					>Delete forever</button
				>{:else}<button class="btn danger sm" type="button" onclick={() => (confirmEmpty = true)}>Empty bin</button
				>{/if}
		{/if}
	</div>

	{#if tab === 'albums'}
		<Albums />
	{/if}

	{#if tab !== 'albums' && loaded && shown.length === 0}
		<div class="empty" data-testid="empty">
			<h3 class="display">
				{tab === 'starred'
					? 'No stars yet.'
					: tab === 'trash'
						? 'The bin is empty.'
						: q
							? 'Nothing matches.'
							: 'Nothing sorted yet.'}
			</h3>
			{#if tab === 'all' && !q}<a class="btn pri" href={resolve('/studio')}>Open Studio</a>{/if}
		</div>
	{/if}

	{#each tab === 'albums' ? [] : groups as g (g.label)}
		<h2 class="eyebrow gh">{g.label}</h2>
		<div class="grid">
			{#each g.items as it (it.id)}
				<figure class="card" class:picked={picked.has(it.id)} data-testid="run" data-run-id={it.id}>
					<label class="pick">
						<input
							type="checkbox"
							checked={picked.has(it.id)}
							onchange={(e) => pickOne(it.id, e.currentTarget.checked)}
							aria-label="Select {it.name}"
							data-testid="pick"
						/>
					</label>
					<div class="acts">
						{#if tab === 'trash'}
							<button class="round" type="button" onclick={() => restore(it)} aria-label="Restore {it.name}"
								><RotateCcw size={16} /></button
							>
						{:else}
							<button
								class="round"
								class:starred={it.starred}
								type="button"
								onclick={() => star(it)}
								aria-label="{it.starred ? 'Unstar' : 'Star'} {it.name}"><Star size={16} /></button
							>
							{#if features.share}<button
									class="round"
									type="button"
									onclick={() => (sharing = runs.filter((r) => r.id === it.id))}
									aria-label="Share {it.name}"><Share2 size={16} /></button
								>{/if}
							<button
								class="round"
								type="button"
								onclick={() => void askBulk('trash', [it.id])}
								aria-label="Move {it.name} to the bin"><Trash2 size={16} /></button
							>
						{/if}
					</div>
					<button
						class="open"
						type="button"
						onclick={(e) => cardClick(e, it)}
						onpointerdown={(e) => startDrag(e, it)}
						aria-label={selectMode ? `Toggle ${it.name}` : `Open ${it.name}`}
						data-testid="run-open"
					>
						<img src={thumb(it.id)} alt="" loading="lazy" draggable="false" />
						{#if it.animated}<span class="animated" data-testid="run-animated">Animated</span>{/if}
					</button>
					<figcaption>
						<b><RunName name={it.name} onsave={(t) => void rename(it.id, t)} /></b><small>{agoText(it.age)}</small>
					</figcaption>
				</figure>
			{/each}
		</div>
	{/each}
</main>

{#if picked.size > 0}
	<div class="bulk glass" role="region" aria-label="Selected pictures" data-testid="bulk-bar">
		<span class="count" role="status" aria-live="polite" data-testid="bulk-count">{picked.size} selected</span>
		<div class="chips">
			<button type="button" onclick={selectEverything} data-testid="bulk-all">Select all</button>
			<button type="button" onclick={clearPick} data-testid="bulk-clear">Clear</button>
		</div>
		{#if tab === 'trash'}
			<button
				class="btn sm"
				type="button"
				disabled={picked.size === 0}
				onclick={() => void askBulk('restore')}
				data-testid="bulk-restore">Restore</button
			>
			<button
				class="btn danger sm"
				type="button"
				disabled={picked.size === 0}
				onclick={() => void askBulk('delete')}
				data-testid="bulk-delete">Delete forever</button
			>
		{:else}
			{#if features.share}<button
					class="btn sm"
					type="button"
					disabled={picked.size === 0}
					onclick={sharePicked}
					data-testid="bulk-share">Share</button
				>{/if}
			<button
				class="btn danger sm"
				type="button"
				disabled={picked.size === 0}
				onclick={() => void askBulk('trash')}
				data-testid="bulk-trash">Move to bin</button
			>
		{/if}
	</div>
{/if}

{#if pending}
	<BulkConfirm
		title={pending.title}
		lines={pending.lines}
		confirmLabel={pending.confirmLabel}
		danger={pending.danger}
		busy={bulkBusy}
		onconfirm={() => void runBulk()}
		oncancel={() => (pending = null)}
	/>
{/if}

{#if sharing && sharing.length}
	<ShareDialog runs={sharing} names={sharing.map((r) => nameOf(r))} onclose={() => (sharing = null)} />
{/if}

{#if viewed}
	{@const it = items.find((i) => i.id === viewed.id)}
	<RunViewer
		run={viewed}
		name={nameOf(viewed)}
		inBin={tab === 'trash'}
		canShare={features.share}
		parentName={viewed.parent_run_id
			? runs.find((r) => r.id === viewed.parent_run_id)
				? nameOf(runs.find((r) => r.id === viewed.parent_run_id)!)
				: null
			: null}
		onclose={closeViewer}
		onrename={(t) => void rename(viewed.id, t)}
		onstar={() => it && void star(it)}
		ontrash={() => {
			if (it) void askBulk('trash', [it.id]);
			closeViewer();
		}}
		onrestore={() => {
			if (it) void restore(it);
			closeViewer();
		}}
		onshare={() => (sharing = [viewed])}
	/>
{/if}

{#if failure}
	<div class="warn glass" role="alertdialog" aria-label={failure.title} data-testid="archive-error">
		<p><b>{failure.title}</b> {failure.body} {failure.safe}</p>
		<button
			class="btn sm pri"
			type="button"
			onclick={() => {
				failure = null;
				retry?.();
			}}>Retry now</button
		>
		<button class="btn sm" type="button" onclick={() => (failure = null)}>Dismiss</button>
	</div>
{/if}

<style>
	.page {
		position: relative;
		z-index: 5;
		max-width: 1200px;
		margin: 0 auto;
		padding: 110px 28px 80px;
		display: grid;
		gap: 16px;
	}
	.page.selected {
		padding-bottom: 160px;
	}
	h1 {
		font-size: 56px;
	}
	.banner {
		padding: 12px 18px;
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 11.5px;
	}
	.banner.full {
		border-color: rgba(255, 90, 54, 0.5);
	}
	.bar {
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
	}
	.search {
		max-width: 260px;
	}
	.warn {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 140;
		padding: 12px 18px;
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 11.5px;
		max-width: min(92vw, 640px);
	}
	.warn p {
		margin: 0;
	}
	/* The bulk action bar: fixed above the bottom edge, with the count announced as it changes. */
	.bulk {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 145;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 12px;
		padding: 10px 16px;
		max-width: min(94vw, 720px);
		font-size: 11.5px;
	}
	.bulk .count {
		font-family: var(--mono);
		letter-spacing: 1.2px;
		text-transform: uppercase;
		color: var(--paper);
	}
	.bulk .chips button {
		min-height: 36px;
	}
	.empty {
		padding: 60px 0;
		display: grid;
		gap: 18px;
		justify-items: start;
	}
	.empty h3 {
		font-size: 44px;
	}
	.gh {
		margin-top: 10px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 14px;
	}
	.card {
		position: relative;
		border: 1px solid var(--faint);
		border-radius: 16px;
		overflow: hidden;
		background: var(--ink2);
	}
	.card.picked {
		border-color: var(--ver);
		box-shadow: 0 0 0 1px var(--ver);
	}
	.pick {
		position: absolute;
		top: 6px;
		left: 6px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(10, 9, 8, 0.7);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.pick input {
		width: 18px;
		height: 18px;
		cursor: pointer;
		accent-color: var(--ver);
	}
	.card:hover .pick,
	.card:focus-within .pick,
	.page.picking .pick {
		opacity: 1;
	}
	.open {
		display: block;
		width: 100%;
		padding: 0;
		cursor: pointer;
	}
	.animated {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 2px 7px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--paper);
		background: rgba(8, 7, 6, 0.72);
		border: 1px solid var(--gold);
	}
	.card img {
		display: block;
		width: 100%;
		aspect-ratio: 8/5;
		object-fit: cover;
	}
	figcaption b {
		display: block;
		min-width: 0;
	}
	figcaption {
		padding: 10px 12px;
		display: grid;
		gap: 2px;
		font-size: 11px;
	}
	figcaption b {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 16px;
	}
	figcaption small {
		color: var(--dim);
	}
	.acts {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.card:hover .acts,
	.card:focus-within .acts {
		opacity: 1;
	}
	.acts .round {
		background: rgba(10, 9, 8, 0.7);
		min-width: 44px;
		min-height: 44px;
	}
	.starred {
		color: var(--gold);
	}
	@media (hover: none) {
		.acts {
			opacity: 1;
		}
	}
	@media (max-width: 700px) {
		.bulk {
			left: 8px;
			right: 8px;
			bottom: 12px;
			transform: none;
			max-width: none;
		}
		.bulk .btn,
		.bulk .chips button {
			min-height: 44px;
		}
		.page.selected {
			padding-bottom: 220px;
		}
	}
</style>
