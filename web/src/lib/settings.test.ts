import { expect, test } from 'vitest';
import { DEFAULTS, DEVICE_RES, sanitize, workCopy, workRes } from './settings';

test('garbage is dropped, numbers are clamped, real values survive', () => {
	const bad = sanitize({
		exportFormat: 'bmp',
		exportQuality: 500,
		workRes: 1000,
		speed: 'fast',
		motion: 'sometimes',
		grain: 'yes',
		shareExpiry: '7',
		evil: 1,
		stripMeta: false
	});
	expect(bad).toEqual({ exportQuality: 100, stripMeta: false });
	expect(sanitize({ workRes: null, exportFormat: 'webp', motion: 'reduce', speed: 0 })).toEqual({
		workRes: null,
		exportFormat: 'webp',
		motion: 'reduce',
		speed: 1
	});
});
test('a corrupt store reads as empty, never throws', () => {
	for (const v of [null, 'x', 5, [], undefined]) expect(sanitize(v)).toEqual({});
});
test('workCopy: long edge capped, aspect kept, never upscaled', () => {
	for (const [w, h, l] of [
		[4032, 2520, 1920],
		[2520, 4032, 1280],
		[800, 600, 1920],
		[1, 5000, 960],
		[6000, 6000, 2560]
	] as const) {
		const c = workCopy(w, h, l);
		expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(l);
		expect(c.w).toBeGreaterThanOrEqual(1);
		if (w <= l && h <= l) expect(c).toMatchObject({ w, h, scaled: false });
		expect(Math.abs(c.w / c.h - w / h)).toBeLessThanOrEqual(0.02 * (w / h) + 1 / Math.min(c.w, c.h));
	}
});
test('workRes: the chosen value, else the device default', () => {
	expect(workRes({ ...DEFAULTS, workRes: 2560 }, 'phone')).toBe(2560);
	expect(workRes(DEFAULTS, 'phone')).toBe(DEVICE_RES.phone);
	expect(workRes(DEFAULTS, 'desktop')).toBe(1920);
});
