// The Pro panel's picture of a cellular rule. The cells come from the engine (its own mask code, see engine/capreview.go);
// this file only turns them into pixels and says when a picture has gone stale.
import type { Params } from './engine/params';

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

/** A one-line caption for the pattern preview, naming the family, variant and space. */
export function patternLabel(p: Pick<Params, 'pattern' | 'patternVariant' | 'caSpace' | 'angle'>): string {
	return p.caSpace === 'line'
		? `${p.pattern} / ${p.patternVariant} · line space, turning with the ${p.angle}° direction`
		: `${p.pattern} / ${p.patternVariant} · image space`;
}

/** Everything that changes what a pattern preview looks like. */
export function patternVersion(
	p: Pick<
		Params,
		| 'pattern'
		| 'patternVariant'
		| 'patternCell'
		| 'patternThickness'
		| 'patternRotate'
		| 'patternDetail'
		| 'patternInvert'
		| 'caSpace'
		| 'angle'
		| 'seed'
	>
): string {
	return [
		p.pattern,
		p.patternVariant,
		p.patternCell,
		p.patternThickness,
		p.patternRotate,
		p.patternDetail,
		p.patternInvert,
		p.caSpace,
		p.caSpace === 'line' ? p.angle : '-',
		p.seed
	].join('|');
}

/** Everything that changes what a preview looks like. The sort angle only counts in line space, where the pattern turns with it. */
export function previewVersion(
	p: Pick<Params, 'caSpace' | 'angle' | 'cell' | 'caBoundary' | 'seed'>,
	rule: number
): string {
	return [rule, p.caSpace, p.caSpace === 'line' ? p.angle : '-', p.cell, p.caBoundary, p.seed].join('|');
}
