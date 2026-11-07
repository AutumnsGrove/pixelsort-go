// Selection for the Archive's bulk actions, as pure functions. The page keeps a Set in $state and replaces it with the
// result of these, so Svelte sees every change; nothing here is reactive itself.

export type Picked = ReadonlySet<number>;

/** Toggle one id, returning a new set. */
export function toggle(picked: Picked, id: number): Set<number> {
	const next = new Set(picked);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/** Add one id, returning a new set. */
export function add(picked: Picked, id: number): Set<number> {
	const next = new Set(picked);
	next.add(id);
	return next;
}

/**
 * The inclusive span between `anchor` and `id` in the order the pictures are shown. `additive` keeps earlier picks, as
 * Shift with Ctrl/Cmd does. With no anchor, or an anchor that is no longer visible, it selects just `id`.
 */
export function range(
	visible: readonly number[],
	picked: Picked,
	anchor: number | null,
	id: number,
	additive = false
): Set<number> {
	const from = anchor === null ? -1 : visible.indexOf(anchor);
	const to = visible.indexOf(id);
	if (from < 0 || to < 0) {
		const next = additive ? new Set(picked) : new Set<number>();
		next.add(id);
		return next;
	}
	const next = additive ? new Set(picked) : new Set<number>();
	const [first, last] = from <= to ? [from, to] : [to, from];
	for (let i = first; i <= last; i++) next.add(visible[i]!);
	return next;
}

/** Select everything currently shown. */
export const selectAll = (visible: readonly number[]): Set<number> => new Set(visible);

/** Drop ids that are no longer shown, so a filter change never acts on a hidden card. */
export function dropHidden(picked: Picked, visible: readonly number[]): Set<number> {
	const shown = new Set(visible);
	const next = new Set<number>();
	for (const id of picked) if (shown.has(id)) next.add(id);
	return next.size === picked.size ? (picked as Set<number>) : next;
}

/** The counts the confirmation dialog says out loud, each selected run counted once. */
export function summarize(
	picked: Picked,
	runs: readonly { id: number; starred: boolean }[],
	shared: ReadonlySet<number>
): { count: number; starred: number; shared: number } {
	let count = 0;
	let starred = 0;
	let sharedCount = 0;
	for (const run of runs) {
		if (!picked.has(run.id)) continue;
		count++;
		if (run.starred) starred++;
		if (shared.has(run.id)) sharedCount++;
	}
	return { count, starred, shared: sharedCount };
}
