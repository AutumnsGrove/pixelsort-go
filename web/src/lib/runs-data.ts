// Pure helpers that turn a list of runs into rows (date headers + chunks of cards) for the virtual list. Port of
// mockups/shared/runs-data.js without its fake-data generator (the real list comes from GET /api/runs).

const DAY_MS = 864e5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The fields of a run the Archive list needs. `age` is whole days before now (0 = today). */
export type RunItem = {
	id: number;
	name: string;
	p: { mode?: string; key?: string; angle?: number; rule?: number };
	age: number;
	starred: boolean;
	bytes?: number;
};

export type Row<T = RunItem> = { type: 'head'; h: number; label: string } | { type: 'cards'; h: number; items: T[] };

/** Whole days between a unix-seconds timestamp and `now` (a Date), by UTC calendar day. */
export function ageInDays(createdAtSeconds: number, now: Date): number {
	const day = (ms: number) => Math.floor(ms / DAY_MS);
	return Math.max(0, day(now.getTime()) - day(createdAtSeconds * 1000));
}

/** "Today", "Yesterday", "This week", "Last week", then "Oct 2026". */
export function groupLabel(age: number, now: Date = new Date()): string {
	if (age <= 0) return 'Today';
	if (age === 1) return 'Yesterday';
	if (age <= 6) return 'This week';
	if (age <= 13) return 'Last week';
	const d = new Date(now.getTime() - age * DAY_MS);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const agoText = (age: number): string =>
	age === 0 ? 'today' : age === 1 ? 'yesterday' : age < 30 ? `${age} days ago` : `${Math.round(age / 30)} mo ago`;

/** Filter by words across the name and the recipe (mode, key, angle, rule), optionally only starred. */
export function filter(runs: RunItem[], o: { q?: string; starred?: boolean } = {}): RunItem[] {
	const words = (o.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
	return runs.filter((r) => {
		if (o.starred && !r.starred) return false;
		if (!words.length) return true;
		const hay =
			`${r.name} ${r.p.mode ?? ''} ${r.p.key ?? ''} ${r.p.angle != null ? r.p.angle + '°' : ''}${r.p.rule ? ' rule ' + r.p.rule : ''}`.toLowerCase();
		return words.every((w) => hay.includes(w));
	});
}

/**
 * Rows for the virtual list. Date-sorted lists get a header row whenever the label changes; other sorts are flat. Each
 * card row holds up to `cols` runs. `jumps` are the header rows, for the jump rail.
 */
export function rows(
	list: RunItem[],
	o: { cols?: number; headH?: number; rowH?: number; sort?: string; now?: Date } = {}
): { rows: Row[]; jumps: { label: string; row: number }[] } {
	const cols = Math.max(1, o.cols ?? 1);
	const headH = o.headH ?? 30;
	const rowH = o.rowH ?? 120;
	const dated = o.sort !== 'big';
	const out: Row[] = [];
	const jumps: { label: string; row: number }[] = [];
	let cur: string | null = null;
	let buf: RunItem[] = [];
	const flush = () => {
		while (buf.length) out.push({ type: 'cards', h: rowH, items: buf.splice(0, cols) });
	};
	for (const r of list) {
		if (dated) {
			const lab = groupLabel(r.age, o.now);
			if (lab !== cur) {
				flush();
				cur = lab;
				jumps.push({ label: lab, row: out.length });
				out.push({ type: 'head', h: headH, label: lab });
			}
		}
		buf.push(r);
		if (buf.length === cols) flush();
	}
	flush();
	return { rows: out, jumps };
}
