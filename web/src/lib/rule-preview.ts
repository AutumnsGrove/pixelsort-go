// The Pro panel's picture of a cellular rule. The cells come from the engine (its own mask code, see engine/capreview.go);
// this file only turns them into pixels and says when a picture has gone stale.
import type { Params } from './engine/params';
import type { Tiling } from './regions';

const ON: [number, number, number] = [236, 228, 211]; // the theater's paper
const OFF: [number, number, number] = [20, 17, 15]; // and its ink

/** One opaque pixel per cell: paper where the rule is on, ink where it is off. */
export function previewPixels(mask: Uint8Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
	if (w < 1 || h < 1 || mask.length !== w * h)
		throw new Error(`a ${w}×${h} preview needs ${w * h} cells, got ${mask.length}`);
	const out = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < mask.length; i++) {
		const c = mask[i] ? ON : OFF;
		out[i * 4] = c[0];
		out[i * 4 + 1] = c[1];
		out[i * 4 + 2] = c[2];
		out[i * 4 + 3] = 255;
	}
	return out;
}

export function previewLabel(rule: number, space: Params['caSpace'], angle: number): string {
	return space === 'line'
		? `Rule ${rule} · line space, turning with the ${angle}° direction`
		: `Rule ${rule} · image space`;
}

/** A one-line caption for the pattern preview: which drawing the shape makes, and which side of it sorts. */
export function patternLabel(t: Pick<Tiling, 'family' | 'variant' | 'invert'>): string {
	return `${t.family} / ${t.variant}` + (t.invert ? ' · the lines are the cells' : '');
}

/** Everything that changes what a pattern preview looks like. A pattern shape is drawn over the picture, so the sort
 * angle plays no part: the drawing turns with the tiling's own rotate. */
export function patternVersion(t: Tiling): string {
	return [t.family, t.variant, t.size, t.gap, t.rotate, t.detail, t.invert, t.seed].join('|');
}

/** Everything that changes what a cellular rule preview looks like. The sort angle only counts in line space. */
export function previewVersion(
	p: Pick<Params, 'caSpace' | 'angle' | 'cell' | 'caBoundary' | 'seed'>,
	rule: number
): string {
	return [rule, p.caSpace, p.caSpace === 'line' ? p.angle : '-', p.cell, p.caBoundary, p.seed].join('|');
}
