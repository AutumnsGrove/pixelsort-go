// Reading an SVG file as data. The text is parsed with DOMParser (which never runs scripts or loads anything), the drawing
// elements are measured in a hidden, detached-from-view <svg> using the browser's own geometry (getTotalLength and
// getPointAtLength) and thrown away. Nothing from the file is ever put into the visible page. Port of parseSVGRaw in
// mockups/shared/regions.js. Browser only; the maths after this point lives in shape-tidy.ts.
import {
	buildShape,
	normalizeRings,
	ringArea,
	splitRings,
	type BuiltShape,
	type Piece,
	type Point,
	type RawShape,
	type Ring
} from './shape-tidy';

const NS = 'http://www.w3.org/2000/svg';
const DRAWABLE = 'path,polygon,polyline,circle,ellipse,rect';
/** Files bigger than this are refused before parsing (a shape outline never needs more). */
export const MAX_SVG_BYTES = 2_000_000;

export const SVG_ERRORS = {
	parse: 'That doesn’t parse as SVG.',
	noSvg: 'No <svg> found in that file.',
	noShapes: 'No shapes in there — I look for path, polygon, circle, ellipse and rect.',
	unmeasurable: 'Couldn’t measure any outline in that SVG.',
	tooBig: 'That file is too big to be a shape outline.'
} as const;

export type SvgRead = { raw: RawShape; error?: undefined } | { raw?: undefined; error: string };

/** The part of an SVG element we measure with; real elements satisfy it, and so can a stand-in in tests. */
type Measurable = Pick<SVGGeometryElement, 'getTotalLength' | 'getPointAtLength'>;

/** Sample one element into rings; sub-paths that the path jumps between become separate rings. */
export function sampleRings(el: Measurable, maxPoints = 240): Ring[] {
	let length: number;
	try {
		length = el.getTotalLength();
	} catch {
		return [];
	}
	if (!length || !Number.isFinite(length)) return [];
	const n = Math.min(maxPoints, Math.max(28, Math.round(length / 2.5)));
	const pts: Point[] = [];
	for (let k = 0; k < n; k++) {
		const q = el.getPointAtLength((k / n) * length);
		pts.push([q.x, q.y]);
	}
	return splitRings(pts, length / n);
}

function measuringHost(): SVGSVGElement {
	const host = document.createElementNS(NS, 'svg');
	host.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:0;height:0;visibility:hidden');
	host.setAttribute('aria-hidden', 'true');
	document.body.appendChild(host);
	return host;
}

/** Outline of a path's `d` attribute alone, for the built-in starter shapes. */
export function flattenPathD(d: string): Ring[] {
	const host = measuringHost();
	try {
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('d', d);
		host.appendChild(p);
		return sampleRings(p, 480);
	} catch {
		return [];
	} finally {
		host.remove();
	}
}

/** Step one: read the file. Returns what was found, or the message to show. */
export function readSvg(text: string): SvgRead {
	if (text.length > MAX_SVG_BYTES) return { error: SVG_ERRORS.tooBig };
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
	if (doc.querySelector('parsererror')) return { error: SVG_ERRORS.parse };
	const svg = doc.documentElement;
	if (!svg || svg.tagName.toLowerCase() !== 'svg') return { error: SVG_ERRORS.noSvg };
	const els = Array.from(svg.querySelectorAll(DRAWABLE));
	if (!els.length) return { error: SVG_ERRORS.noShapes };
	const host = measuringHost();
	const pieces: Piece[] = [];
	try {
		for (const e of els) {
			// Only the geometry matters: copy just the attributes the shape is drawn from, never scripts or handlers.
			const clone = document.createElementNS(NS, e.tagName.toLowerCase()) as SVGGeometryElement;
			for (const a of GEOMETRY_ATTRS) if (e.hasAttribute(a)) clone.setAttribute(a, e.getAttribute(a)!);
			host.appendChild(clone);
			let rings: Ring[] = [];
			try {
				rings = sampleRings(clone, 480);
			} catch {
				rings = [];
			}
			let len = 0;
			try {
				len = clone.getTotalLength();
			} catch {
				len = 0;
			}
			if (rings.length) pieces.push({ rings, len });
		}
	} finally {
		host.remove();
	}
	if (!pieces.length) return { error: SVG_ERRORS.unmeasurable };
	return { raw: { pieces, elements: els.length } };
}

/** Attributes that decide a shape's outline. Everything else on an element (events, styles, links) is left behind. */
const GEOMETRY_ATTRS = [
	'd',
	'points',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'x',
	'y',
	'width',
	'height',
	'pathLength',
	'transform'
];

/** A dropped or pasted file that is an SVG: it becomes a shape, never the picture. */
export const isSvgFile = (f: { name?: string; type: string }): boolean =>
	f.type === 'image/svg+xml' || /\.svg$/i.test(f.name ?? '');
/** Pasted text that is SVG code (not a web address, not anything else). */
export const looksLikeSvg = (text: string): boolean =>
	/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text);

/** Read and build with sensible defaults (the largest piece, holes kept), for files that need no tidying. */
export function parseSvg(text: string): { shape: BuiltShape; elements: number } | { error: string } {
	const r = readSvg(text);
	if (r.error !== undefined) return { error: r.error };
	return { shape: buildShape(r.raw), elements: r.raw.elements };
}

export type Starter = { name: string; d: string };
/** The starter library. Compound ones (Ring, Frame, Target) have rings inside the outline that cut holes (even-odd). */
export const STARTERS: readonly Starter[] = [
	{ name: 'Star', d: 'M50 5 L61 38 L96 38 L68 59 L79 93 L50 72 L21 93 L32 59 L4 38 L39 38 Z' },
	{
		name: 'Heart',
		d: 'M50 88 C20 66 6 48 6 32 C6 18 17 9 30 9 C40 9 47 15 50 22 C53 15 60 9 70 9 C83 9 94 18 94 32 C94 48 80 66 50 88 Z'
	},
	{ name: 'Drop', d: 'M50 6 C50 6 18 44 18 64 C18 82 32 94 50 94 C68 94 82 82 82 64 C82 44 50 6 50 6 Z' },
	{ name: 'Bolt', d: 'M58 4 L20 56 L46 56 L38 96 L80 40 L54 40 Z' },
	{
		name: 'Moon',
		d: 'M62 6 C36 10 18 30 18 54 C18 78 38 94 62 94 C74 94 84 90 90 84 C66 84 50 70 50 52 C50 34 62 18 84 14 C78 9 70 6 62 6 Z'
	},
	{ name: 'Leaf', d: 'M12 88 C12 40 46 8 90 10 C92 54 60 90 12 88 Z' },
	{ name: 'Cross', d: 'M38 6 H62 V38 H94 V62 H62 V94 H38 V62 H6 V38 H38 Z' },
	{ name: 'Arrow', d: 'M50 4 L92 46 H66 V96 H34 V46 H8 Z' },
	{ name: 'Ring', d: 'M50 4 A46 46 0 1 0 50 96 A46 46 0 1 0 50 4 Z M50 28 A22 22 0 1 0 50 72 A22 22 0 1 0 50 28 Z' },
	{ name: 'Frame', d: 'M6 6 H94 V94 H6 Z M26 26 V74 H74 V26 Z' },
	{
		name: 'Target',
		d: 'M50 4 A46 46 0 1 0 50 96 A46 46 0 1 0 50 4 Z M50 20 A30 30 0 1 0 50 80 A30 30 0 1 0 50 20 Z M50 36 A14 14 0 1 0 50 64 A14 14 0 1 0 50 36 Z'
	}
];

const starterCache = new Map<number, { poly: Ring; more: Ring[] }>();
/** A starter as an outline plus extra rings, fitted to the unit square. Measured once, then remembered. */
export function starterShape(i: number): { poly: Ring; more: Ring[] } {
	const hit = starterCache.get(i);
	if (hit) return hit;
	const s = STARTERS[i];
	if (!s) throw new RangeError(`no starter shape ${i}`);
	const rings = flattenPathD(s.d).sort((a, b) => ringArea(b) - ringArea(a));
	const n = normalizeRings(rings);
	const out = { poly: n[0] ?? [], more: n.slice(1) };
	starterCache.set(i, out);
	return out;
}
