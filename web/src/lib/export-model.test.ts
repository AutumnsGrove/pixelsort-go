import { expect, test } from 'vitest';
import {
	BAND_STEPS,
	DEVICES,
	bandRanges,
	estimateBytes,
	filename,
	memoryMB,
	plan,
	suggestScale,
	type DeviceId
} from './export-model';

test('plan fits the budget, uses the fewest bands, and "too large" is honest; suggested scales fit', () => {
	let bad = 0;
	let n = 0;
	for (const dev of Object.keys(DEVICES) as DeviceId[])
		for (let mp = 0.5; mp <= 160; mp *= 1.37)
			for (const ar of [1, 1.5, 1.78, 0.67]) {
				const h = Math.round(Math.sqrt((mp * 1e6) / ar));
				const w = Math.round(h * ar);
				const p = plan(w, h, dev);
				n++;
				if (p.verdict !== 'toolarge') {
					if (p.memMB > p.budgetMB + 1e-9) bad++;
					const i = BAND_STEPS.indexOf(p.bands);
					if (i < 0) bad++;
					if (i > 0 && memoryMB(w * h, BAND_STEPS[i - 1]!) <= p.budgetMB) bad++;
					if ((p.bands === 1) !== (p.verdict === 'ok')) bad++;
				} else {
					if (memoryMB(w * h, 64) <= p.budgetMB) bad++;
					const s = suggestScale(w, h, dev);
					if (s !== null && plan(Math.round(w * s), Math.round(h * s), dev).verdict === 'toolarge') bad++;
				}
			}
	expect(n).toBeGreaterThan(50);
	expect(bad).toBe(0);
});

test('a 50 MP photo: too large for a phone, fine on a desktop', () => {
	expect(plan(8660, 5774, 'phone').verdict).toBe('toolarge');
	expect(plan(8660, 5774, 'desktop').verdict).toBe('ok');
});
test('24 MP on a phone is exported in 2 bands; 10 MP in one pass', () => {
	const p = plan(6000, 4000, 'phone');
	expect(p).toMatchObject({ verdict: 'banded', bands: 2 });
	expect(plan(4032, 2520, 'phone').verdict).toBe('ok');
});
test('banding never goes below the 8 B/px floor; 50 MP on a phone suggests 75 %', () => {
	expect(memoryMB(50e6, 64)).toBeGreaterThan(8 * 50);
	expect(suggestScale(8660, 5774, 'phone')).toBe(0.75);
});
test('band ranges tile the lines exactly, with no gap or overlap', () => {
	for (const [lines, bands] of [
		[2520, 1],
		[2520, 7],
		[5774, 64],
		[10, 64]
	] as const) {
		const r = bandRanges(lines, bands);
		expect(r[0]![0]).toBe(0);
		expect(r[bands - 1]![1]).toBe(lines);
		r.forEach((x, i) => i && expect(x[0]).toBe(r[i - 1]![1]));
	}
});
test('size estimates: quality up = bigger, WebP < JPEG < PNG', () => {
	expect(estimateBytes('jpeg', 95, 1e7)).toBeGreaterThan(estimateBytes('jpeg', 50, 1e7));
	expect(estimateBytes('webp', 90, 1e7)).toBeLessThan(estimateBytes('jpeg', 90, 1e7));
	expect(estimateBytes('png', 0, 1e7)).toBeGreaterThan(estimateBytes('jpeg', 100, 1e7));
});
test('filenames are slugs: no slashes, spaces or symbols', () => {
	expect(filename('Sunset Ridge!', 'Main · 31°', 'jpeg', '0f3a')).toBe('sunset-ridge-main-31-0f3a.jpg');
	expect(filename('../../etc/passwd', '<x>', 'png', '')).toMatch(/^[a-z0-9.-]+$/);
});
