// "Looks like a circle": suggests an ellipse or rectangle for a hand-drawn loop. Accepting it replaces the stroke with an
// editable object. Pure maths. Port of MaskEditor.guessShape in mockups/shared/mask-editor.js.

export type Guess = {
	kind: 'ellipse' | 'rect';
	cx: number; // fractions of the picture
	cy: number;
	w: number;
	h: number;
	label: 'circle' | 'ellipse' | 'rectangle';
};

/** `pts` are working-pixel points of one stroke, in order; `w`, `h` the picture size. Returns null when nothing fits. */
export function guessShape(pts: readonly (readonly [number, number])[], w: number, h: number): Guess | null {
	if (pts.length < 14) return null;
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const x0 = Math.min(...xs);
	const x1 = Math.max(...xs);
	const y0 = Math.min(...ys);
	const y1 = Math.max(...ys);
	const a = (x1 - x0) / 2;
	const b = (y1 - y0) / 2;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	if (a < 14 || b < 14) return null;
	const first = pts[0]!;
	const last = pts[pts.length - 1]!;
	if (Math.hypot(first[0] - last[0], first[1] - last[1]) > Math.max(a, b) * 0.7) return null; // not a closed loop
	let ellipseDev = 0;
	let rectDev = 0;
	for (const p of pts) {
		const e = ((p[0] - cx) / a) ** 2 + ((p[1] - cy) / b) ** 2;
		ellipseDev += Math.abs(Math.sqrt(e) - 1);
		rectDev += Math.min(Math.min(p[0] - x0, x1 - p[0]) / a, Math.min(p[1] - y0, y1 - p[1]) / b);
	}
	ellipseDev /= pts.length;
	rectDev /= pts.length;
	// a loop hugging the edges of its box is a rectangle; check that first, since a square also sits close to a circle
	const kind = rectDev < 0.06 ? 'rect' : ellipseDev < 0.2 ? 'ellipse' : rectDev < 0.16 ? 'rect' : null;
	if (!kind) return null;
	return {
		kind,
		cx: cx / w,
		cy: cy / h,
		w: (a * 2) / w,
		h: (b * 2) / h,
		label: kind === 'ellipse' ? (Math.abs(a - b) < a * 0.15 ? 'circle' : 'ellipse') : 'rectangle'
	};
}
