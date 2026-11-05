// Mask objects on the canvas: the geometry of moving, resizing and rotating them. Pure maths, tested without a browser.
// Objects are stored as fractions of the picture (centre and size) plus a rotation in degrees, so the preview and a
// full-size export agree. Port of the geometry in mockups/shared/mask-editor.js.
import type { MaskObject } from './regions';

export type Size = { w: number; h: number }; // the picture in working pixels
/** A handle's place on the box: -1, 0 or 1 on each axis. (-1,-1) is the top-left corner. */
export type Handle = readonly [-1 | 0 | 1, -1 | 0 | 1];
export const HANDLES: readonly Handle[] = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0]
];
export const CURSORS: Record<string, string> = {
	'-1,-1': 'nwse-resize',
	'0,-1': 'ns-resize',
	'1,-1': 'nesw-resize',
	'1,0': 'ew-resize',
	'1,1': 'nwse-resize',
	'0,1': 'ns-resize',
	'-1,1': 'nesw-resize',
	'-1,0': 'ew-resize'
};

const RAD = Math.PI / 180;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const MIN_SIZE_PX = 6;

/** A point in the object's own (rotated) frame, in working pixels, to the picture's frame. */
export function toWorld(o: MaskObject, s: Size, lx: number, ly: number): [number, number] {
	const t = o.rot * RAD;
	return [o.cx * s.w + lx * Math.cos(t) - ly * Math.sin(t), o.cy * s.h + lx * Math.sin(t) + ly * Math.cos(t)];
}
/** The inverse: a point in the picture's frame to the object's own frame. */
export function toLocal(o: MaskObject, s: Size, px: number, py: number): [number, number] {
	const t = -o.rot * RAD;
	const dx = px - o.cx * s.w;
	const dy = py - o.cy * s.h;
	return [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
}

/** Where each of the eight handles and the rotate knob sit, in working pixels. `knob` is how far above the box (px). */
export function handlePositions(
	o: MaskObject,
	s: Size,
	knob = 20
): { handles: [number, number][]; rotate: [number, number] } {
	const hw = (o.w * s.w) / 2;
	const hh = (o.h * s.h) / 2;
	return {
		handles: HANDLES.map((h) => toWorld(o, s, h[0] * hw, h[1] * hh)),
		rotate: toWorld(o, s, 0, -hh - knob)
	};
}

/** Moving: the same shape, shifted by (dx, dy) working pixels from where the drag began. The centre stays on the picture. */
export function move(start: MaskObject, s: Size, dx: number, dy: number): MaskObject {
	return { ...start, cx: clamp01(start.cx + dx / s.w), cy: clamp01(start.cy + dy / s.h) };
}

/** Nudging with the arrow keys: one pixel, or ten with Shift. */
export function nudge(o: MaskObject, s: Size, dx: number, dy: number, big = false): MaskObject {
	const k = big ? 10 : 1;
	return move(o, s, dx * k, dy * k);
}

/**
 * Resizing by a handle dragged to picture point `p`. The opposite side stays put. Shift (or a polygon) keeps the
 * proportions on a corner. A side handle changes one dimension only.
 */
export function resize(start: MaskObject, s: Size, h: Handle, p: [number, number], keepRatio = false): MaskObject {
	const [lx, ly] = toLocal(start, s, p[0], p[1]);
	const hw = (start.w * s.w) / 2;
	const hh = (start.h * s.h) / 2;
	const ax = h[0] ? -h[0] * hw : 0; // the anchor: the side opposite the handle
	const ay = h[1] ? -h[1] * hh : 0;
	let nw = h[0] ? Math.max(MIN_SIZE_PX, Math.abs(lx - ax)) : hw * 2;
	let nh = h[1] ? Math.max(MIN_SIZE_PX, Math.abs(ly - ay)) : hh * 2;
	if (keepRatio && h[0] && h[1]) {
		const k = Math.max(nw / (hw * 2), nh / (hh * 2));
		nw = hw * 2 * k;
		nh = hh * 2 * k;
	}
	const cxl = h[0] ? ax + (h[0] * nw) / 2 : 0;
	const cyl = h[1] ? ay + (h[1] * nh) / 2 : 0;
	const [wx, wy] = toWorld(start, s, cxl, cyl);
	return { ...start, cx: wx / s.w, cy: wy / s.h, w: nw / s.w, h: nh / s.h };
}

/** Rotating by dragging the knob to `p`: 0..359 degrees, and Shift snaps to multiples of 15. */
export function rotate(start: MaskObject, s: Size, p: [number, number], snap = false): MaskObject {
	let a = (Math.atan2(p[1] - start.cy * s.h, p[0] - start.cx * s.w) * 180) / Math.PI + 90;
	if (snap) a = Math.round(a / 15) * 15;
	return { ...start, rot: ((Math.round(a) % 360) + 360) % 360 };
}

/** A copy a little down and to the right, so it does not hide its original. */
export function duplicate(o: MaskObject): MaskObject {
	return { ...o, cx: Math.min(0.95, o.cx + 0.04), cy: Math.min(0.95, o.cy + 0.06) };
}

/** What the engine's `masks.Spec` takes: objects as fractions, plus the invert toggle (a toggle, never a bake). */
export function toSpec(objects: readonly MaskObject[], invert: boolean, feather: number): object {
	return {
		objects: objects.map((o) => ({ kind: o.kind, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rot: o.rot, mode: o.mode })),
		...(invert ? { invert: true } : {}),
		...(feather > 0 ? { feather } : {})
	};
}
