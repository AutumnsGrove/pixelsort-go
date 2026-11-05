// The cell outline overlay: pure pixel maths, so it can be tested without a canvas. Edges between two different labels
// get a light outline; cells get a faint tint of their class's colour. Port of overlay() in mockups/shared/regions.js.

/** Colours for classes 0.. (0 = the gaps). Warm and distinct on the dark stage. */
export const CLASS_COLORS: readonly [number, number, number][] = [
	[236, 228, 211],
	[255, 90, 54],
	[232, 184, 106],
	[159, 208, 138],
	[110, 168, 220],
	[200, 140, 220],
	[220, 120, 150],
	[150, 150, 150],
	[240, 240, 120]
];

export function classColor(c: number): [number, number, number] {
	return [...(CLASS_COLORS[c] ?? CLASS_COLORS[0]!)] as [number, number, number];
}

/** RGBA pixels (w*h*4) for the overlay: outlines at alpha 150, class tint at alpha 46, nothing in the gaps. */
export function overlayPixels(labels: Uint16Array, classOf: Uint8Array, w: number, h: number): Uint8ClampedArray {
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const lab = labels[i] ?? 0;
			const p = i * 4;
			const edge = (x + 1 < w && labels[i + 1] !== lab) || (y + 1 < h && labels[i + w] !== lab);
			if (edge) {
				out[p] = 236;
				out[p + 1] = 228;
				out[p + 2] = 211;
				out[p + 3] = 150;
			} else if (lab) {
				const [r, g, b] = classColor(classOf[lab] ?? 1);
				out[p] = r;
				out[p + 1] = g;
				out[p + 2] = b;
				out[p + 3] = 46;
			}
		}
	}
	return out;
}
