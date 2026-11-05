// Turning the outlines read from an SVG into one custom shape: which pieces to keep, whether holes stay, how many
// points. Pure maths with no DOM, so it is tested in Node. Port of buildShape/needsTidy/simplifyRing/normalizeRings in
// mockups/shared/regions.js. Points are [x, y] pairs; rings are closed implicitly (the last joins the first).

export type Point = [number, number];
export type Ring = Point[];
/** One drawn element's outlines (a path with several sub-paths gives several rings) and the length of its outline. */
export type Piece = { rings: Ring[]; len: number };
export type RawShape = { pieces: Piece[]; elements: number };

export type TidyOptions = {
	pieces?: 'largest' | 'all';
	holes?: boolean; // keep the holes (default true)
	minHole?: number; // fill holes smaller than this fraction (0..1) of the solid area
	simplify?: number; // Douglas-Peucker tolerance as a fraction (0..1) of the shape's diagonal
};
export type ShapeStats = { points: number; rings: number; holes: number; pieces: number; droppedRings: number };
export type BuiltShape = { poly: Ring; more: Ring[]; stats: ShapeStats; info: string };

export function ringArea(r: Ring): number {
	let a = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
	return Math.abs(a) / 2;
}

/** Even-odd point-in-ring test. */
export function inRing(pt: Point, r: Ring): boolean {
	let inside = false;
	for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
		const [xa, ya] = r[a]!;
		const [xb, yb] = r[b]!;
		if (ya > pt[1] !== yb > pt[1] && pt[0] < ((xb - xa) * (pt[1] - ya)) / (yb - ya) + xa) inside = !inside;
	}
	return inside;
}

/** Douglas-Peucker on one ring, treated as the open polyline first..last. Keeps at least three points. */
export function simplifyRing(r: Ring, eps: number): Ring {
	if (!eps || r.length <= 4) return r.slice();
	const keep = new Uint8Array(r.length);
	keep[0] = keep[r.length - 1] = 1;
	const stack: [number, number][] = [[0, r.length - 1]];
	while (stack.length) {
		const [i0, i1] = stack.pop()!;
		const [ax, ay] = r[i0]!;
		const [bx, by] = r[i1]!;
		const dx = bx - ax;
		const dy = by - ay;
		const L = Math.hypot(dx, dy) || 1e-9;
		let best = -1;
		let bd = 0;
		for (let i = i0 + 1; i < i1; i++) {
			const d = Math.abs(dy * (r[i]![0] - ax) - dx * (r[i]![1] - ay)) / L;
			if (d > bd) {
				bd = d;
				best = i;
			}
		}
		if (best > 0 && bd > eps) {
			keep[best] = 1;
			stack.push([i0, best], [best, i1]);
		}
	}
	const out = r.filter((_, k) => keep[k]);
	return out.length >= 3 ? out : r.slice(0, 3);
}

/** Fit any set of rings into the unit square together, keeping proportions, centred with a small margin. */
export function normalizeRings(rings: Ring[]): Ring[] {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const r of rings)
		for (const [x, y] of r) {
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
	const w = x1 - x0 || 1;
	const h = y1 - y0 || 1;
	const sc = 0.92 / Math.max(w, h);
	const ox = (1 - w * sc) / 2;
	const oy = (1 - h * sc) / 2;
	return rings.map((r) => r.map(([x, y]): Point => [(x - x0) * sc + ox, (y - y0) * sc + oy]));
}

/** Split a sampled outline into rings wherever the path jumps (a new sub-path), judged by the sampling step. */
export function splitRings(pts: Point[], step: number): Ring[] {
	if (!pts.length) return [];
	const rings: Ring[] = [];
	let cur: Ring = [pts[0]!];
	for (let i = 1; i < pts.length; i++) {
		const [x, y] = pts[i]!;
		const [px, py] = pts[i - 1]!;
		if (Math.hypot(x - px, y - py) > step * 1.8 + 1e-6) {
			rings.push(cur);
			cur = [];
		}
		cur.push([x, y]);
	}
	rings.push(cur);
	return rings.filter((r) => r.length >= 3);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The words under the preview: "2 pieces, 1 hole, 84 points". */
export function statsText(s: ShapeStats): string {
	const parts = [plural(s.pieces, 'piece')];
	if (s.holes) parts.push(plural(s.holes, 'hole'));
	parts.push(plural(s.points, 'point'));
	return parts.join(', ');
}

/** Apply the tidy-up choices to what was read from the file. */
export function buildShape(raw: RawShape, opts: TidyOptions = {}): BuiltShape {
	const keepHoles = opts.holes !== false;
	const minHole = opts.minHole ?? 0;
	let pick = raw.pieces.slice();
	if ((opts.pieces ?? 'largest') === 'largest' && pick.length) {
		let big = pick[0]!;
		for (const p of pick) if (p.len > big.len) big = p;
		pick = [big];
	}
	const rings = pick
		.flatMap((p) => p.rings)
		.map((ring) => ({ ring, area: ringArea(ring), depth: 0 }))
		.sort((a, b) => b.area - a.area);
	// nesting depth by the even-odd rule: even is solid, odd is a hole
	rings.forEach((r, i) => {
		for (let j = 0; j < i; j++) if (inRing(r.ring[0]!, rings[j]!.ring)) r.depth++;
	});
	let solid = 0;
	for (const r of rings) if (r.depth % 2 === 0) solid += r.area;
	const kept = rings.filter((r) => {
		if (r.depth === 0) return true;
		if (!keepHoles) return false;
		return !(r.depth % 2 === 1 && minHole && r.area < minHole * solid);
	});
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const r of kept)
		for (const [x, y] of r.ring) {
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
	const eps = (opts.simplify ?? 0) * (kept.length ? Math.hypot(x1 - x0, y1 - y0) : 0);
	const norm = normalizeRings(kept.map((r) => simplifyRing(r.ring, eps)));
	const points = norm.reduce((n, r) => n + r.length, 0);
	const holes = kept.filter((r) => r.depth % 2 === 1).length;
	const pieces = kept.filter((r) => r.depth % 2 === 0).length;
	const stats: ShapeStats = { points, rings: norm.length, holes, pieces, droppedRings: rings.length - kept.length };
	return { poly: norm[0] ?? [], more: norm.slice(1), stats, info: statsText(stats) };
}

/** Does this file need the tidy-up step (several pieces, nested rings, or a lot of points)? */
export function needsTidy(raw: RawShape): boolean {
	const all = buildShape(raw, { pieces: 'all' });
	const one = buildShape(raw, { pieces: 'largest' });
	return raw.pieces.length > 1 || one.stats.holes > 0 || all.stats.points > 300;
}
