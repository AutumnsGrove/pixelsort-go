// "Cut out this object": turns the engine's outline into an SVG the shape library already reads (so the same validation, tidy
// panel and storage apply as for a pasted shape), and names it. Pure: no DOM, tested in Node.

export type Outline = [number, number][];
export type BBox = [number, number, number, number];

/** Room around the shape inside its viewBox, in pixels. */
const PAD = 2;

const n = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '0');

/** The outline as a closed SVG path, moved so the shape starts near the corner rather than where it sat in the picture. */
export function outlinePathD(outline: Outline, bbox: BBox): string {
	const ox = bbox[0] - PAD;
	const oy = bbox[1] - PAD;
	return outline.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x - ox + 0.5)} ${n(y - oy + 0.5)}`).join('') + 'Z';
}

/** A complete SVG document holding just the outline. It is data only: one path, no scripts, no links. */
export function outlineSvg(outline: Outline, bbox: BBox): string {
	const w = bbox[2] + PAD * 2;
	const h = bbox[3] + PAD * 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path d="${outlinePathD(outline, bbox)}"/></svg>`;
}

/** A plain-word colour for an average colour: "red", "dark blue", "pale grey". */
export function colorName([r, g, b]: [number, number, number]): string {
	const [R, G, B] = [r, g, b].map((v) => (Number.isFinite(v) ? Math.min(255, Math.max(0, v)) / 255 : 0)) as [
		number,
		number,
		number
	];
	const mx = Math.max(R, G, B);
	const mn = Math.min(R, G, B);
	const l = (mx + mn) / 2;
	const d = mx - mn;
	let hue = 0;
	if (d > 0.001) {
		if (mx === R) hue = ((G - B) / d + 6) % 6;
		else if (mx === G) hue = (B - R) / d + 2;
		else hue = (R - G) / d + 4;
		hue *= 60;
	}
	// near-black and near-white have no hue worth naming (a few levels of noise would read as "blue")
	if (l < 0.1) return 'dark grey';
	if (l > 0.92) return 'pale grey';
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	const base =
		s < 0.14
			? 'grey'
			: hue < 15 || hue >= 345
				? 'red'
				: hue < 40
					? 'orange'
					: hue < 70
						? 'yellow'
						: hue < 160
							? 'green'
							: hue < 200
								? 'teal'
								: hue < 255
									? 'blue'
									: hue < 300
										? 'purple'
										: 'pink';
	return (l < 0.2 ? 'dark ' : l > 0.78 ? 'pale ' : '') + base;
}

/** The name offered for a cut-out: its colour and the word "shape". */
export function cutoutName(mean: [number, number, number]): string {
	const c = colorName(mean);
	return `${c.charAt(0).toUpperCase()}${c.slice(1)} shape`;
}

/** What to say when the engine will not make a shape from the spot that was clicked. */
export function refusalText(reason: 'too-big' | 'too-small'): string {
	return reason === 'too-big'
		? 'That area spreads over too much of the picture. Lower the tolerance, or click a more distinct spot.'
		: 'That area is too small or too thin to make a shape from. Raise the tolerance, or click a bigger area.';
}

/** The tolerance slider: how far a colour may stray from the clicked spot and still be part of the shape. */
export const TOLERANCE = { min: 5, max: 80, start: 32 } as const;
