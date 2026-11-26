// The region and protect model the Studio's Pro panel edits: a tiling spec, per-class rules and mask objects. Pure data
// and pure helpers; the engine rasterises everything from these vector descriptions (PLAN.md 3.4).

export const SHAPES = ['square', 'hexagon', 'triangle', 'diamond', 'circle', 'octagon', 'voronoi', 'pattern'] as const;
/** How cells are classed (the engine's shapes.Classify), not which shape they are. */
export const PATTERNS = ['all', 'checker', 'thirds', 'random'] as const;

// The pattern catalog, kept in step with engine/patterns.Catalog(). The panel reads the notes and variants from the
// engine; this list is what validation and old-run loading need without starting a worker.
export const patternFamilies = ['truchet', 'interference', 'radial', 'grid'] as const;
export const patternVariants: Record<string, readonly string[]> = {
	truchet: ['arc', 'strand', 'hex'],
	interference: ['mesh', 'rings'],
	radial: ['spiral', 'spokes', 'broken'],
	grid: ['woven', 'chevron', 'iso']
};

export type Tiling = {
	shape: (typeof SHAPES)[number] | 'custom';
	/** custom: brick offset on odd rows. */
	stagger?: boolean;
	/** custom: the outline in the unit square, and extra rings (holes or more pieces, even-odd). */
	poly?: [number, number][];
	more?: [number, number][][];
	size: number; // per mille of the picture width (a pattern's cell)
	gap: number; // per mille of the picture width (a pattern's line thickness)
	rotate: number; // whole degrees
	seed: number;
	pattern: (typeof PATTERNS)[number]; // how cells are classed
	kinds: number; // how many classes the "random" pattern uses
	/**
	 * A pattern shape's drawing: which family and variant of engine/patterns, its arms or spokes, and whether to swap
	 * which side of the drawing becomes the cells. Only a pattern shape reads them.
	 */
	family: string;
	variant: string;
	detail: number;
	invert: boolean;
};
/** A brush stroke: a round-capped polyline. `radius` is a fraction of the picture's width, points are fractions too. */
export type Stroke = { radius: number; erase?: boolean; points: [number, number][] };
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
	// A pattern draws lines rather than tiles, so it starts on a smaller cell with a heavier line.
	size: shape === 'pattern' ? 60 : 90,
	gap: shape === 'pattern' ? 8 : 6,
	rotate: 0,
	seed,
	pattern: 'checker',
	kinds: 3,
	family: 'truchet',
	variant: 'arc',
	detail: 5,
	invert: false
});

/** How many classes a pattern produces (class 0, the gaps, is not counted). */
export function classCount(pattern: Tiling['pattern'], kinds: number): number {
	return pattern === 'all' ? 1 : pattern === 'checker' ? 2 : pattern === 'thirds' ? 3 : Math.min(8, Math.max(1, kinds));
}
