// A TypeScript mirror of engine.Params (engine/params.go): same field names, same ranges. The shared table in
// engine/testdata/params-cases.json keeps the two honest.

export const modes = [
	'random',
	'wave',
	'threshold',
	'edges',
	'ca',
	'ca-edges',
	'pattern',
	'pattern-edges',
	'none'
] as const;
export const keys = [
	'luma',
	'value',
	'intensity',
	'minimum',
	'hue',
	'saturation',
	'red',
	'green',
	'blue',
	'alpha'
] as const;
export const algos = ['oddeven', 'insertion', 'merge', 'reveal'] as const;
export const caSpaces = ['image', 'line'] as const;
export const caBoundaries = ['random', 'wrap', 'fixed'] as const;

// The pattern catalog, kept in step with engine/patterns.Catalog(). The panel reads the notes and variants from the
// engine; this list is what validation and old-run loading need without starting a worker.
export const patternFamilies = ['truchet', 'interference', 'radial', 'grid'] as const;
export const patternVariants: Record<string, readonly string[]> = {
	truchet: ['arc', 'strand', 'hex'],
	interference: ['mesh', 'rings'],
	radial: ['spiral', 'spokes', 'broken'],
	grid: ['woven', 'chevron', 'iso']
};
const allPatternVariants = Object.values(patternVariants).flat();

export type Mode = (typeof modes)[number];
export type SortKey = (typeof keys)[number];
export type Algo = (typeof algos)[number];

export interface Params {
	mode: Mode;
	key: SortKey;
	reverse: boolean;
	angle: number;
	length: number;
	randomness: number;
	waveAmp: number;
	wavePeriod: number;
	lo: number;
	hi: number;
	thresholdKey: SortKey;
	edge: number;
	rule: number;
	cell: number;
	caSpace: (typeof caSpaces)[number];
	caBoundary: (typeof caBoundaries)[number];
	pattern: string;
	patternVariant: string;
	patternCell: number;
	patternThickness: number;
	patternRotate: number;
	patternDetail: number;
	patternInvert: boolean;
	patternOverlay: boolean;
	algo: Algo;
	seed: number;
}

export const defaultParams: Readonly<Params> = Object.freeze({
	mode: 'random',
	key: 'luma',
	reverse: false,
	angle: 0,
	length: 83,
	randomness: 10,
	waveAmp: 70,
	wavePeriod: 0,
	lo: 51,
	hi: 209,
	thresholdKey: 'luma',
	edge: 26,
	rule: 110,
	cell: 8,
	caSpace: 'image',
	caBoundary: 'random',
	pattern: 'truchet',
	patternVariant: 'arc',
	patternCell: 60,
	patternThickness: 8,
	patternRotate: 0,
	patternDetail: 5,
	patternInvert: false,
	patternOverlay: false,
	algo: 'oddeven',
	seed: 7
});

const intRanges: Record<string, [number, number]> = {
	angle: [0, 359],
	length: [1, 1000],
	randomness: [0, 100],
	waveAmp: [0, 100],
	wavePeriod: [0, 1000],
	lo: [0, 255],
	hi: [0, 255],
	edge: [0, 255],
	rule: [0, 255],
	cell: [1, 1000],
	patternCell: [1, 1000],
	patternThickness: [1, 500],
	patternRotate: [0, 359],
	patternDetail: [1, 16],
	seed: [0, 0xffffffff]
};

const enums: Record<string, readonly string[]> = {
	mode: modes,
	key: keys,
	thresholdKey: keys,
	algo: algos,
	caSpace: caSpaces,
	caBoundary: caBoundaries,
	pattern: patternFamilies,
	patternVariant: allPatternVariants
};

/** Returns a message naming the first problem with a recipe, or null when it is valid. */
export function validateParams(p: Params): string | null {
	for (const [name, list] of Object.entries(enums)) {
		if (!list.includes((p as unknown as Record<string, unknown>)[name] as string))
			return `${name} ${JSON.stringify((p as unknown as Record<string, unknown>)[name])}`;
	}
	for (const [name, [lo, hi]] of Object.entries(intRanges)) {
		const v = (p as unknown as Record<string, unknown>)[name];
		if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi)
			return `${name} ${String(v)} outside ${lo}..${hi}`;
	}
	if (typeof p.reverse !== 'boolean') return 'reverse must be true or false';
	if (p.pattern && !(patternVariants[p.pattern] ?? []).includes(p.patternVariant))
		return `patternVariant ${JSON.stringify(p.patternVariant)} is not a ${p.pattern} variant`;
	if (p.lo > p.hi) return `lo ${p.lo} is above hi ${p.hi}`;
	return null;
}

/** Parses JSON on top of the defaults like engine.ParseParams: unknown fields and wrong types are rejected. */
export function parseParams(text: string): { ok: true; params: Params } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, error: `not JSON: ${(e as Error).message}` };
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		return { ok: false, error: 'a recipe is an object' };
	for (const name of Object.keys(raw)) {
		if (!(name in defaultParams)) return { ok: false, error: `unknown field ${name}` };
	}
	const params = { ...defaultParams, ...(raw as Partial<Params>) };
	const problem = validateParams(params);
	return problem ? { ok: false, error: problem } : { ok: true, params };
}

/**
 * Reads a recipe from something untrusted (a stored run, which an older version or another tool may have written): keeps what
 * is valid, clamps numbers into their ranges, and falls back to the default for anything missing, unknown or the wrong type.
 */
export function clampParams(raw: unknown): Params {
	const o = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
	const out: Record<string, unknown> = { ...defaultParams };
	for (const [name, list] of Object.entries(enums)) {
		if (typeof o[name] === 'string' && list.includes(o[name] as string)) out[name] = o[name];
	}
	for (const [name, [lo, hi]] of Object.entries(intRanges)) {
		const v = o[name];
		if (typeof v === 'number' && Number.isFinite(v)) out[name] = Math.min(hi, Math.max(lo, Math.round(v)));
	}
	if (typeof o.reverse === 'boolean') out.reverse = o.reverse;
	// A stored pattern may name a variant from another family (or one that no longer exists): keep the family and
	// fall back to its first variant rather than handing the engine a pair it will refuse.
	const fam = out.pattern as string;
	const variants = patternVariants[fam] ?? [];
	if (!variants.includes(out.patternVariant as string))
		out.patternVariant = variants[0] ?? defaultParams.patternVariant;
	const p = out as unknown as Params;
	if (p.lo > p.hi) p.hi = p.lo;
	return p;
}
