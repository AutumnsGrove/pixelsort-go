// Brush painting on the picture: collecting a stroke from pointer positions, and turning a hand-drawn loop into an object.
// Pure maths (the pointer plumbing is in BrushLayer.svelte). A stroke is stored as fractions of the picture, like objects.
import type { MaskObject, Stroke } from './regions';
import { guessShape, type Guess } from './snap';

export type Tool = 'move' | 'paint' | 'erase';
export type Size = { w: number; h: number };

/** Brush radius as a fraction of the picture's width: 0.5 % .. 12 %. */
export const MIN_RADIUS = 0.005;
export const MAX_RADIUS = 0.12;
export const DEFAULT_RADIUS = 0.03;
export const clampRadius = (r: number): number => Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A screen position (in working pixels) as a point of the picture, kept inside it. */
export const toFraction = (px: number, py: number, s: Size): [number, number] => [clamp01(px / s.w), clamp01(py / s.h)];

/**
 * Append a point to a stroke being drawn, unless it is closer than `minDist` (in working pixels) to the last one, so a
 * slow drag does not pile up thousands of points. Returns a new array.
 */
export function addPoint(
	points: readonly [number, number][],
	p: [number, number],
	s: Size,
	minDist = 2
): [number, number][] {
	const last = points[points.length - 1];
	if (last && Math.hypot((p[0] - last[0]) * s.w, (p[1] - last[1]) * s.h) < minDist) return points.slice();
	return [...points, p];
}

/** Start a stroke. A single tap is a dot: it gets a second point in the same place so the engine draws a round cap. */
export function finishStroke(points: readonly [number, number][], radius: number, erase: boolean): Stroke | null {
	if (!points.length) return null;
	const pts = points.length === 1 ? [points[0]!, points[0]!] : points.slice();
	return { radius: clampRadius(radius), ...(erase ? { erase: true } : {}), points: pts };
}

/** Does this finished paint stroke look like a loop that should become an ellipse or rectangle? (Never for erasing.) */
export function suggestFor(stroke: Stroke, s: Size): Guess | null {
	if (stroke.erase) return null;
	return guessShape(
		stroke.points.map((p): [number, number] => [p[0] * s.w, p[1] * s.h]),
		s.w,
		s.h
	);
}

/**
 * Accept a suggestion: the stroke at `index` is removed and the object takes its place, so nothing is doubled up.
 * Returns the strokes that remain and the object to add.
 */
export function acceptGuess(
	strokes: readonly Stroke[],
	index: number,
	g: Guess
): { strokes: Stroke[]; object: MaskObject } {
	return {
		strokes: strokes.filter((_, i) => i !== index),
		object: { kind: g.kind, cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: 0, mode: 'add' }
	};
}

/** The SVG points attribute of a stroke in working pixels, for drawing it live. */
export const strokePoints = (points: readonly [number, number][], s: Size): string =>
	points.map(([x, y]) => `${Math.round(x * s.w * 10) / 10},${Math.round(y * s.h * 10) / 10}`).join(' ');
