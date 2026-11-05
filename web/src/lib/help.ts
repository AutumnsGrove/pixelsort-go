// The keyboard-shortcut table: the single source of truth. The shortcut sheet renders it and the Studio's key handler
// is tested against it, so the sheet can never promise a key that does nothing. Port of SHORTCUTS in
// mockups/shared/help.js.

export type ShortcutId =
	'play' | 'restart' | 'compare' | 'peek' | 'paint' | 'pro' | 'new' | 'export' | 'rename' | 'runs' | 'help' | 'esc';
export type Shortcut = { id: ShortcutId; keys: string[]; what: string };
export type ShortcutGroup = { group: string; items: Shortcut[] };

export const SHORTCUTS: readonly ShortcutGroup[] = [
	{
		group: 'Watching',
		items: [
			{ id: 'play', keys: ['Space'], what: 'Play or pause' },
			{ id: 'restart', keys: ['R'], what: 'Start over' },
			{ id: 'compare', keys: ['C'], what: 'Hold to see the original' },
			{ id: 'peek', keys: ['T'], what: 'Show which pixels can move' }
		]
	},
	{
		group: 'Making',
		items: [
			{ id: 'paint', keys: ['P'], what: 'Protect brush' },
			{ id: 'pro', keys: ['Tab'], what: 'Pro panel — shapes and masks' },
			{ id: 'new', keys: ['N'], what: 'Bring a new picture' },
			{ id: 'export', keys: ['E'], what: 'Export' },
			{ id: 'rename', keys: ['F2'], what: 'Name this picture' }
		]
	},
	{
		group: 'Around',
		items: [
			{ id: 'runs', keys: ['G'], what: 'Runs strip' },
			{ id: 'help', keys: ['?'], what: 'This sheet' },
			{ id: 'esc', keys: ['Esc'], what: 'Close whatever is open' }
		]
	}
];

export const flat = (): Shortcut[] => SHORTCUTS.flatMap((g) => g.items);

/** Which shortcut a key press means, or null. Typing in a field never triggers one (except Escape). */
export function shortcutFor(e: {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	target?: unknown;
}): ShortcutId | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	const t = e.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
	const typing =
		!!t &&
		(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);
	const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (k === 'Escape') return 'esc';
	if (typing) return null;
	for (const s of flat()) {
		for (const key of s.keys) {
			const want = key === 'Space' ? ' ' : key.length === 1 ? key.toLowerCase() : key;
			if (k === want) return s.id;
		}
	}
	return null;
}
