import { expect, test } from 'vitest';
import { workingSize } from './image-intake';

test.each([
	[4032, 2520, 1920],
	[2520, 4032, 1280],
	[800, 600, 1920],
	[1, 5000, 960],
	[5000, 1, 960],
	[6000, 6000, 2560],
	[1, 1, 1920]
])('workingSize(%i, %i, %i): capped, aspect kept, never upscaled', (w, h, long) => {
	const c = workingSize(w, h, long);
	expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(long);
	expect(c.w).toBeGreaterThanOrEqual(1);
	expect(c.h).toBeGreaterThanOrEqual(1);
	if (w <= long && h <= long) expect(c).toMatchObject({ w, h, scaled: false });
	// A one-pixel-wide result cannot keep the aspect exactly; every other size must, to within a pixel.
	if (Math.min(c.w, c.h) > 1)
		expect(Math.abs(c.w / c.h - w / h)).toBeLessThanOrEqual(0.02 * (w / h) + 1 / Math.min(c.w, c.h));
});
