// What a saved run holds, and how it is read back. A run's `settings` is a free-form JSON object: the sort params sit at the
// top level exactly as they always have (so old runs, and the server's duplicate check on a plain sort, are unchanged), and a
// look that has cells or protected areas adds two keys, `regions` and `mask`. Everything read back is untrusted: it may come
// from an older version, or have been damaged, so it is validated and clamped, never trusted.
import { clampParams, keys, modes, algos, type Params } from './engine/params';
import { clampCard, newCard, type RegionCard } from './region-cards';
import { PATTERNS, SHAPES, type MaskObject, type Stroke, type Tiling } from './regions';

export type MaskPart = { objects: MaskObject[]; strokes: Stroke[]; invert: boolean; feather: number };
/** Everything that makes a picture look the way it does, apart from the original pixels. */
export type LookParts = {
	params: Params;
	tiling: Tiling | null;
	cards: Record<number, RegionCard>;
	mask: MaskPart | null;
};
export type OpenedLook = {
	params: Params;
	tiling: Tiling | null;
	cards: Record<number, RegionCard> | null;
	mask: MaskPart | null;
};

const MAX_OBJECTS = 100;
const MAX_STROKES = 500;
const MAX_POINTS = 5000;
const MAX_RINGS = 64;
const MAX_RING_POINTS = 2000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The settings object to store: the params, plus the cells and protected areas only when there are some. */
export function packRecipe(look: LookParts): Record<string, unknown> {
	const out: Record<string, unknown> = { ...look.params };
	if (look.tiling) out.regions = { tiling: look.tiling, cards: look.cards };
	const m = look.mask;
	if (m && (m.objects.length > 0 || m.strokes.length > 0 || m.invert))
		out.mask = { objects: m.objects, strokes: m.strokes, invert: m.invert, feather: m.feather };
	return out;
}

function readRing(v: unknown, max: number): [number, number][] | null {
	if (!Array.isArray(v) || v.length > max) return null;
	const out: [number, number][] = [];
	for (const p of v) {
		if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) return null;
		out.push([p[0], p[1]]);
	}
	return out;
}

function readTiling(v: unknown): Tiling | null {
	if (!isObj(v)) return null;
	const shape = v.shape;
	if (typeof shape !== 'string' || !(shape === 'custom' || (SHAPES as readonly string[]).includes(shape))) return null;
	if (!num(v.size) || !num(v.gap) || !num(v.rotate) || !num(v.seed)) return null;
	if (typeof v.pattern !== 'string' || !(PATTERNS as readonly string[]).includes(v.pattern)) return null;
	const t: Tiling = {
		shape: shape as Tiling['shape'],
		size: clampInt(v.size, 1, 1000),
		gap: clampInt(v.gap, 0, 1000),
		rotate: clampInt(v.rotate, 0, 359),
		seed: clampInt(v.seed, 0, 0xffffffff),
		pattern: v.pattern as Tiling['pattern'],
		kinds: num(v.kinds) ? clampInt(v.kinds, 1, 8) : 3
	};
	if (shape === 'custom') {
		const poly = readRing(v.poly, MAX_RING_POINTS);
		if (!poly || poly.length < 3) return null; // a custom shape without an outline cannot be cut
		t.poly = poly;
		if (Array.isArray(v.more)) {
			const more = v.more.slice(0, MAX_RINGS).map((r) => readRing(r, MAX_RING_POINTS));
			t.more = more.filter((r): r is [number, number][] => r !== null);
		}
		if (typeof v.stagger === 'boolean') t.stagger = v.stagger;
	}
	return t;
}

const ORDERS = ['', 'asc', 'desc'];
const CARD_MODE = ['random', 'wave', 'threshold', 'edges', 'ca', 'none'];

function readCards(v: unknown): Record<number, RegionCard> | null {
	if (!isObj(v)) return null;
	const out: Record<number, RegionCard> = {};
	for (const [k, raw] of Object.entries(v)) {
		const i = Number(k);
		if (!Number.isInteger(i) || i < 0 || i > 8 || !isObj(raw)) continue;
		const over: Partial<RegionCard> = {};
		for (const f of ['frozen', 'angleOn', 'cutOn', 'open'] as const) if (typeof raw[f] === 'boolean') over[f] = raw[f];
		for (const f of ['angle', 'length', 'randomness', 'lo', 'hi', 'edge', 'rule', 'cell'] as const)
			if (num(raw[f])) over[f] = raw[f];
		if (typeof raw.key === 'string' && (raw.key === '' || (keys as readonly string[]).includes(raw.key)))
			over.key = raw.key as RegionCard['key'];
		if (typeof raw.order === 'string' && ORDERS.includes(raw.order)) over.order = raw.order as RegionCard['order'];
		if (typeof raw.algo === 'string' && (raw.algo === '' || (algos as readonly string[]).includes(raw.algo)))
			over.algo = raw.algo as RegionCard['algo'];
		if (typeof raw.mode === 'string' && CARD_MODE.includes(raw.mode)) over.mode = raw.mode as RegionCard['mode'];
		const name = typeof raw.name === 'string' ? raw.name.slice(0, 40) : `Kind ${i}`;
		out[i] = clampCard(newCard(name, over));
	}
	return Object.keys(out).length > 0 ? out : null;
}

function readMask(v: unknown): MaskPart | null {
	if (!isObj(v)) return null;
	const objects: MaskObject[] = [];
	for (const o of Array.isArray(v.objects) ? v.objects.slice(0, MAX_OBJECTS) : []) {
		if (!isObj(o) || (o.kind !== 'ellipse' && o.kind !== 'rect') || (o.mode !== 'add' && o.mode !== 'cut')) continue;
		if (!num(o.cx) || !num(o.cy) || !num(o.w) || !num(o.h) || !num(o.rot)) continue;
		objects.push({ kind: o.kind, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rot: o.rot, mode: o.mode });
	}
	const strokes: Stroke[] = [];
	for (const s of Array.isArray(v.strokes) ? v.strokes.slice(0, MAX_STROKES) : []) {
		if (!isObj(s) || !num(s.radius)) continue;
		const points = readRing(Array.isArray(s.points) ? s.points.slice(0, MAX_POINTS) : null, MAX_POINTS);
		if (!points || points.length === 0) continue;
		strokes.push({ radius: s.radius, points, ...(s.erase === true ? { erase: true } : {}) });
	}
	const invert = v.invert === true;
	if (objects.length === 0 && strokes.length === 0 && !invert) return null;
	return { objects, strokes, invert, feather: num(v.feather) ? clampInt(v.feather, 0, 24) : 0 };
}

/** Reads a stored run's settings back into a look. Missing pieces (an old run) come back as null, meaning "none". */
export function unpackRecipe(settings: unknown): OpenedLook {
	const o = isObj(settings) ? settings : {};
	const regions = isObj(o.regions) ? o.regions : null;
	const tiling = regions ? readTiling(regions.tiling) : null;
	return {
		params: clampParams(o),
		tiling,
		cards: tiling && regions ? readCards(regions.cards) : null,
		mask: readMask(o.mask)
	};
}

export type SlateRow = { label: string; value: string };

/** The recipe in plain words, for the Archive viewer. Reads from the stored object, so it works for any run, old or new. */
export function recipeSlate(settings: Record<string, unknown>): SlateRow[] {
	const look = unpackRecipe(settings);
	const p = look.params;
	const rows: SlateRow[] = [{ label: 'Intervals', value: modes.includes(p.mode) ? p.mode : String(p.mode) }];
	if (p.mode === 'ca' || p.mode === 'ca-edges')
		rows.push({ label: 'Cellular rule', value: `${p.rule}, in ${p.caSpace} space` });
	else if (p.mode === 'threshold') rows.push({ label: 'Band', value: `${p.thresholdKey} ${p.lo} to ${p.hi}` });
	else if (p.mode === 'edges') rows.push({ label: 'Edge level', value: String(p.edge) });
	if (p.mode === 'random' || p.mode === 'wave')
		rows.push({ label: 'Length', value: `${p.length}${p.mode === 'random' ? `, randomness ${p.randomness}` : ''}` });
	rows.push({ label: 'Sort by', value: p.key + (p.reverse ? ', reversed' : '') });
	rows.push({ label: 'Direction', value: `${p.angle}°` });
	rows.push({ label: 'Method', value: p.algo });
	if (look.tiling) {
		const t = look.tiling;
		rows.push({ label: 'Shapes', value: `${t.shape === 'custom' ? 'custom shape' : t.shape}, ${t.pattern}` });
	}
	if (look.mask) {
		const m = look.mask;
		const parts: string[] = [];
		if (m.objects.length) parts.push(`${m.objects.length} shape${m.objects.length === 1 ? '' : 's'}`);
		if (m.strokes.length) parts.push(`${m.strokes.length} brush stroke${m.strokes.length === 1 ? '' : 's'}`);
		if (m.invert) parts.push('inverted');
		rows.push({ label: 'Protected', value: parts.join(', ') });
	}
	return rows;
}
