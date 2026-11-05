// The model behind a region card: what one kind of shape does. Anything left unset inherits the global recipe. Pure data and
// pure functions (no DOM), shared by Studio's Pro panel and the phone sheet. Port of the model half of
// mockups/shared/region-cards.js. Values are in the engine's own units (length and cell per mille of the picture's width,
// lo/hi/edge 0..255) so what a card holds is exactly what the engine receives; the UI shows pixels.
import type { Algo, Mode, SortKey } from './engine/params';

export type ClassDef = {
	frozen?: boolean;
	angle?: number;
	key?: SortKey;
	reverse?: boolean;
	mode?: Mode;
	length?: number;
	randomness?: number;
	lo?: number;
	hi?: number;
	edge?: number;
	rule?: number;
	cell?: number;
	algo?: Algo;
};

/** "either way" leaves the global direction alone. */
export type Order = '' | 'asc' | 'desc';
export type RegionCard = {
	name: string;
	frozen: boolean;
	angleOn: boolean;
	angle: number;
	key: SortKey | '';
	order: Order;
	algo: Algo | '';
	cutOn: boolean;
	mode: Mode;
	length: number;
	randomness: number;
	lo: number;
	hi: number;
	edge: number;
	rule: number;
	cell: number;
	open: boolean;
};

export const CARD_KEYS: readonly SortKey[] = [
	'luma',
	'value',
	'intensity',
	'hue',
	'saturation',
	'red',
	'green',
	'blue'
];
/** The cutting modes a card offers (the global panel also has edge-aware cellular automata). */
export const CARD_MODES: readonly Mode[] = ['random', 'wave', 'threshold', 'edges', 'ca', 'none'];
export const MODE_LABEL: Record<string, string> = {
	random: 'random',
	wave: 'wave',
	threshold: 'threshold',
	edges: 'edges',
	ca: 'cellular',
	'ca-edges': 'cellular edges',
	none: 'none'
};
export const ALGO_LABEL: Record<string, string> = {
	oddeven: 'odd-even',
	insertion: 'insertion',
	merge: 'merge',
	reveal: 'reveal'
};
/** Animation algorithms a card can pick; '' means "same as global". */
export const CARD_ALGOS: readonly (Algo | '')[] = ['', 'oddeven', 'insertion', 'reveal'];
export const RULE_PICKS = [26, 110, 154, 45, 106, 30] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v) || 0));
const wrapAngle = (v: number) => (((Math.round(v) || 0) % 360) + 360) % 360;

/** A card with nothing overridden. The numbers are what the cutting recipe starts at when it is switched on. */
export function newCard(name: string, over: Partial<RegionCard> = {}): RegionCard {
	return {
		name,
		frozen: false,
		angleOn: false,
		angle: 0,
		key: '',
		order: '',
		algo: '',
		cutOn: false,
		mode: 'random',
		length: 83,
		randomness: 10,
		lo: 51,
		hi: 209,
		edge: 26,
		rule: 110,
		cell: 8,
		open: false,
		...over
	};
}

/** The cards a person starts with: the gaps (always frozen) and the first three kinds. */
export function defaultCards(): Record<number, RegionCard> {
	return {
		0: newCard('Between shapes', { frozen: true }),
		1: newCard('Kind A'),
		2: newCard('Kind B', { angleOn: true, angle: 90 }),
		3: newCard('Kind C', { angleOn: true, angle: 45, key: 'hue' })
	};
}

/** Whole-number clean-up for a value typed or dragged into a card, so the engine never receives something out of range. */
export function clampCard(c: RegionCard): RegionCard {
	const lo = clamp(c.lo, 0, 255);
	return {
		...c,
		angle: wrapAngle(c.angle),
		length: clamp(c.length, 1, 1000),
		randomness: clamp(c.randomness, 0, 100),
		lo,
		hi: Math.max(lo, clamp(c.hi, 0, 255)),
		edge: clamp(c.edge, 0, 255),
		rule: clamp(c.rule, 0, 255),
		cell: clamp(c.cell, 1, 1000)
	};
}

function detail(c: RegionCard): string {
	switch (c.mode) {
		case 'random':
		case 'wave':
			return ` ${c.length}`;
		case 'threshold':
			return ` ${c.lo}–${c.hi}`;
		case 'ca':
		case 'ca-edges':
			return ` ${c.rule}`;
		case 'edges':
			return ` ${c.edge}`;
		default:
			return '';
	}
}

/** One line for the folded card, e.g. "90° · hue ↓ · insertion · cellular 110". */
export function cardSummary(c: RegionCard): string {
	if (c.frozen) return 'frozen — never moves';
	const parts: string[] = [];
	if (c.angleOn) parts.push(`${c.angle}°`);
	if (c.key || c.order)
		parts.push((c.key || 'global key') + (c.order === 'desc' ? ' ↓' : c.order === 'asc' ? ' ↑' : ''));
	if (c.algo) parts.push(ALGO_LABEL[c.algo] ?? c.algo);
	if (c.cutOn) parts.push((MODE_LABEL[c.mode] ?? c.mode) + detail(c));
	return parts.length ? parts.join(' · ') : 'inherits everything';
}

/** The engine's ClassDef for one card: only what the card overrides is present, so everything else inherits. */
export function cardToClassDef(card: RegionCard): ClassDef {
	const c = clampCard(card);
	const d: ClassDef = {};
	if (c.frozen) d.frozen = true;
	if (c.angleOn) d.angle = c.angle;
	if (c.key) d.key = c.key;
	if (c.order) d.reverse = c.order === 'desc';
	if (c.algo) d.algo = c.algo;
	if (c.cutOn) {
		d.mode = c.mode;
		switch (c.mode) {
			case 'random':
			case 'wave':
				d.length = c.length;
				break;
			case 'threshold':
				d.lo = c.lo;
				d.hi = c.hi;
				break;
			case 'edges':
				d.edge = c.edge;
				break;
			case 'ca':
			case 'ca-edges':
				d.rule = c.rule;
				d.cell = c.cell;
				break;
		}
		if (c.mode !== 'none') d.randomness = c.randomness;
	}
	return d;
}

/** How many shapes each kind has, from the engine's per-cell class map (cell 0 is the gaps and is not a shape). */
export function kindCounts(classOf: Uint8Array | null): Record<number, number> {
	const counts: Record<number, number> = {};
	if (classOf)
		for (let cell = 1; cell < classOf.length; cell++) counts[classOf[cell]!] = (counts[classOf[cell]!] ?? 0) + 1;
	return counts;
}

/** What the engine's region map wants: one definition per class, index 0 being the gaps between shapes (always frozen). */
export function cardsToClassDefs(cards: Record<number, RegionCard>, top: number): ClassDef[] {
	const out: ClassDef[] = [{ frozen: true }];
	for (let k = 1; k <= top; k++) out.push(cardToClassDef(cards[k] ?? newCard(`Kind ${k}`)));
	return out;
}
