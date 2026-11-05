// The region and protect model the Studio's Pro panel edits: a tiling spec, per-class rules and mask objects. Pure data
// and pure helpers; the engine rasterises everything from these vector descriptions (PLAN.md 3.4).

export const SHAPES = ['square', 'hexagon', 'triangle', 'diamond', 'circle', 'octagon', 'voronoi'] as const;
export const PATTERNS = ['all', 'checker', 'thirds', 'random'] as const;

export type Tiling = {
	shape: (typeof SHAPES)[number];
	size: number; // per mille of the picture width
	gap: number; // per mille of the picture width
	rotate: number; // whole degrees
	seed: number;
	pattern: (typeof PATTERNS)[number];
	kinds: number; // how many classes the "random" pattern uses
};
export type ClassRule = { frozen?: boolean; angle?: number; key?: string; reverse?: boolean; algo?: string };
export type ClassDefs = Record<number, ClassRule>;
export type MaskObject = {
	kind: 'ellipse' | 'rect';
	cx: number;
	cy: number;
	w: number;
	h: number;
	rot: number;
	mode: 'add' | 'cut';
};

/** The tiling a person gets when they first pick a shape. */
export const defaultTiling = (shape: Tiling['shape'], seed: number): Tiling => ({
	shape,
	size: 90,
	gap: 6,
	rotate: 0,
	seed,
	pattern: 'checker',
	kinds: 3
});

/** How many classes a pattern produces (class 0, the gaps, is not counted). */
export function classCount(pattern: Tiling['pattern'], kinds: number): number {
	return pattern === 'all' ? 1 : pattern === 'checker' ? 2 : pattern === 'thirds' ? 3 : Math.min(8, Math.max(1, kinds));
}

/** The engine wants one definition per class; index 0 is the gaps between shapes, which stay frozen. */
export function classDefsToEngine(defs: ClassDefs, top: number): object[] {
	const out: object[] = [{ frozen: true }];
	for (let c = 1; c <= top; c++) {
		const r = defs[c] ?? {};
		const d: Record<string, unknown> = {};
		if (r.frozen) d.frozen = true;
		if (r.angle !== undefined) d.angle = r.angle;
		if (r.key) d.key = r.key;
		if (r.reverse !== undefined) d.reverse = r.reverse;
		if (r.algo) d.algo = r.algo;
		out.push(d);
	}
	return out;
}

/** A readable one-line summary of a class's rules, for its card. */
export function describeClass(r: ClassRule): string {
	if (r.frozen) return 'frozen';
	const parts: string[] = [];
	if (r.angle !== undefined) parts.push(`${r.angle}°`);
	if (r.key) parts.push(`by ${r.key}`);
	if (r.reverse) parts.push('reversed');
	if (r.algo) parts.push(r.algo);
	return parts.length ? parts.join(' · ') : 'same as the rest';
}
