import { expect, test } from 'vitest';
import {
	duplicate,
	handlePositions,
	HANDLES,
	move,
	nudge,
	resize,
	rotate,
	toLocal,
	toSpec,
	toWorld
} from './mask-model';
import { guessShape } from './snap';
import type { MaskObject } from './regions';

const S = { w: 1000, h: 500 };
const obj = (over: Partial<MaskObject> = {}): MaskObject => ({
	kind: 'rect',
	cx: 0.5,
	cy: 0.5,
	w: 0.2,
	h: 0.4,
	rot: 0,
	mode: 'add',
	...over
});
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

test('local and world are inverses, at any rotation', () => {
	for (const rot of [0, 30, 90, 217]) {
		const o = obj({ rot, cx: 0.3, cy: 0.7 });
		const [wx, wy] = toWorld(o, S, 40, -25);
		const [lx, ly] = toLocal(o, S, wx, wy);
		near(lx, 40);
		near(ly, -25);
	}
});

test('moving shifts the centre and keeps it on the picture', () => {
	const m = move(obj(), S, 100, -50);
	near(m.cx, 0.6);
	near(m.cy, 0.4);
	expect(move(obj(), S, 99999, -99999)).toMatchObject({ cx: 1, cy: 0 });
	expect(nudge(obj(), S, 1, 0).cx).toBeCloseTo(0.501);
	expect(nudge(obj(), S, 1, 0, true).cx).toBeCloseTo(0.51);
});

test('resizing by a corner keeps the opposite corner fixed', () => {
	const o = obj(); // box from x 400..600, y 150..350 (px)
	const r = resize(o, S, [1, 1], [700, 450]); // drag the bottom-right corner out
	near(r.cx * S.w - (r.w * S.w) / 2, 400); // left edge unchanged
	near(r.cy * S.h - (r.h * S.h) / 2, 150); // top edge unchanged
	near(r.w * S.w, 300);
	near(r.h * S.h, 300);
});

test('resizing a side handle changes one dimension only', () => {
	const r = resize(obj(), S, [1, 0], [800, 999]);
	near(r.h, 0.4);
	near(r.w * S.w, 400);
});

test('Shift keeps the proportions on a corner', () => {
	const r = resize(obj(), S, [1, 1], [900, 360], true);
	near((r.w * S.w) / (r.h * S.h), 200 / 200); // the box started 200 x 200 px
});

test('a shape never collapses below a few pixels', () => {
	const r = resize(obj(), S, [1, 1], [400, 150]);
	expect(r.w * S.w).toBeGreaterThanOrEqual(6);
	expect(r.h * S.h).toBeGreaterThanOrEqual(6);
});

test('resizing a rotated shape works in its own frame', () => {
	const o = obj({ rot: 90 });
	const [hx, hy] = handlePositions(o, S).handles[HANDLES.findIndex((h) => h[0] === 1 && h[1] === 0)]!;
	const r = resize(o, S, [1, 0], [hx + 20, hy]); // pushing the right handle's world position by 20 px along x
	expect(r.rot).toBe(90);
	expect(r.w).toBeCloseTo(0.2, 2); // along its local x (the world y axis) nothing was dragged
});

test('rotating: 0 to 359 degrees, Shift snaps to 15', () => {
	const o = obj();
	near(rotate(o, S, [500, 100]).rot, 0); // straight above the centre
	near(rotate(o, S, [900, 250]).rot, 90);
	near(rotate(o, S, [500, 400]).rot, 180);
	expect(rotate(o, S, [900, 300], true).rot % 15).toBe(0);
	expect(rotate(o, S, [100, 250]).rot).toBe(270);
});

test('a duplicate is offset and the original is untouched', () => {
	const o = obj({ cx: 0.5 });
	const d = duplicate(o);
	expect(d.cx).toBeGreaterThan(o.cx);
	expect(o.cx).toBe(0.5);
	expect(duplicate(obj({ cx: 0.99, cy: 0.99 }))).toMatchObject({ cx: 0.95, cy: 0.95 });
});

test('the engine spec: objects as fractions, invert is a toggle, feather only when set', () => {
	expect(toSpec([obj()], false, 0)).toEqual({
		objects: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.2, h: 0.4, rot: 0, mode: 'add' }]
	});
	expect(toSpec([], true, 0.1)).toEqual({ objects: [], invert: true, feather: 0.1 });
});

// ---- snap ----
const loop = (n: number, noise: number, seed = 1) => {
	let s = seed;
	const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
	return Array.from({ length: n }, (_, i): [number, number] => {
		const t = (i / (n - 1)) * Math.PI * 2;
		return [400 + 100 * Math.cos(t) + rnd() * noise, 250 + 100 * Math.sin(t) + rnd() * noise];
	});
};

test('a noisy circle of 200 points is suggested as a circle', () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		const g = guessShape(loop(200, 6, seed), 1000, 500);
		expect(g?.kind).toBe('ellipse');
		expect(g?.label).toBe('circle');
		expect(g!.cx).toBeCloseTo(0.4, 1);
		expect(g!.cy).toBeCloseTo(0.5, 1);
	}
});

test('a wide loop is an ellipse, a square-cornered loop is a rectangle', () => {
	const wide = loop(120, 2).map(([x, y]): [number, number] => [400 + (x - 400) * 2, y]);
	expect(guessShape(wide, 1000, 500)?.label).toBe('ellipse');
	const rect: [number, number][] = [];
	for (let i = 0; i <= 30; i++) rect.push([300 + i * 10, 200]);
	for (let i = 1; i <= 20; i++) rect.push([600, 200 + i * 10]);
	for (let i = 1; i <= 30; i++) rect.push([600 - i * 10, 400]);
	for (let i = 1; i <= 20; i++) rect.push([300, 400 - i * 10]);
	expect(guessShape(rect, 1000, 500)?.kind).toBe('rect');
});

test('a scribble that is not closed, or is too small, or too short gives null', () => {
	const open = loop(100, 1).slice(0, 60); // three-fifths of a circle
	expect(guessShape(open, 1000, 500)).toBeNull();
	expect(
		guessShape(
			loop(100, 0).map(([x, y]): [number, number] => [x / 20, y / 20]),
			1000,
			500
		)
	).toBeNull();
	expect(guessShape(loop(10, 0), 1000, 500)).toBeNull();
	let s = 7;
	const scribble = Array.from({ length: 80 }, (): [number, number] => [
		(s = (s * 48271) % 2147483647) % 500,
		(s = (s * 48271) % 2147483647) % 300
	]);
	expect(guessShape(scribble, 1000, 500)).toBeNull();
});
