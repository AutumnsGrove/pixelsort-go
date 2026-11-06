import { expect, test } from '@playwright/test';

// Everything in the dock must be reachable at every size. Its contents are about 1020px wide, so wherever the screen is
// narrower than that the dock has to scroll sideways; a dock that just overflows hides the Pro button off the edge of the
// screen (this happened on an iPad held upright: Pro could not be opened at all).
const SIZES: [number, number][] = [
	[360, 640],
	[390, 844],
	[844, 390],
	[507, 900],
	[768, 1024],
	[820, 1180],
	[1024, 768],
	[1280, 720],
	[1440, 900]
];

for (const [w, h] of SIZES) {
	test(`${w}x${h}: the dock's buttons are all reachable, Save stays in view, and Pro opens`, async ({ page }) => {
		await page.setViewportSize({ width: w, height: h });
		await page.goto('/studio');
		await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
		const m = await page.evaluate(() => {
			const dock = document.querySelector('.dock')!;
			const cs = getComputedStyle(dock);
			const d = dock.getBoundingClientRect();
			return {
				scrolls: dock.scrollWidth <= dock.clientWidth + 1 || cs.overflowX === 'auto' || cs.overflowX === 'scroll',
				left: d.left,
				right: d.right
			};
		});
		expect(m.scrolls, 'a dock wider than the screen has to scroll').toBe(true);
		expect(m.left).toBeGreaterThanOrEqual(0);
		expect(m.right).toBeLessThanOrEqual(w + 0.5);
		// Save is pinned: it is inside the screen whatever the dock has scrolled to
		const save = page.getByTestId('save');
		const sb = (await save.boundingBox())!;
		expect(sb.x).toBeGreaterThanOrEqual(0);
		expect(sb.x + sb.width).toBeLessThanOrEqual(w + 0.5);
		// the last button, Pro, can be brought into view and used
		await page.getByTestId('pro-toggle').scrollIntoViewIfNeeded();
		const pb = (await page.getByTestId('pro-toggle').boundingBox())!;
		expect(pb.x + pb.width, 'Pro is on screen once scrolled to').toBeLessThanOrEqual(w + 0.5);
		await page.getByTestId('pro-toggle').click({ timeout: 5000 });
		await expect(page.getByTestId('pro')).toBeVisible();
		// and Save is still where it was after scrolling
		const sb2 = (await save.boundingBox())!;
		expect(sb2.x).toBeGreaterThanOrEqual(0);
		expect(sb2.x + sb2.width).toBeLessThanOrEqual(w + 0.5);
	});
}
