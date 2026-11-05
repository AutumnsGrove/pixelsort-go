import { expect, test, type Page } from '@playwright/test';

// Brush painting in the Pro panel's Protect section: paint protects, erase gives back, a loop can snap into an object.

async function open(page: Page): Promise<void> {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();
}

/** Share of pixels the engine says cannot move, shown as a veil while T is held (read once the sort has settled). */
async function veiled(page: Page): Promise<number> {
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.waitForTimeout(300);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // shortcuts ignore a focused field
	await page.keyboard.down('t');
	await page.waitForTimeout(400);
	const v = await page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] === 170) n++;
		return n / (d.length / 4);
	});
	await page.keyboard.up('t');
	return v;
}

async function frame(page: Page) {
	return (await page.getByTestId('stage').boundingBox())!;
}
async function drag(page: Page, pts: [number, number][]): Promise<void> {
	const b = await frame(page);
	const at = ([fx, fy]: [number, number]): [number, number] => [b.x + fx * b.width, b.y + fy * b.height];
	await page.mouse.move(...at(pts[0]!));
	await page.mouse.down();
	for (const p of pts.slice(1)) await page.mouse.move(...at(p));
	await page.mouse.up();
}
const line = (n = 20): [number, number][] => Array.from({ length: n }, (_, i) => [0.1 + (0.8 * i) / (n - 1), 0.5]);
const circle = (r = 0.2, n = 60): [number, number][] =>
	Array.from({ length: n }, (_, i): [number, number] => {
		const a = (i / (n - 1)) * 2 * Math.PI;
		return [0.5 + r * Math.cos(a), 0.5 + r * 1.25 * Math.sin(a)];
	});

test('paint protects pixels, erase gives them back, clear removes the strokes', async ({ page }) => {
	await open(page);
	const base = await veiled(page); // the default recipe already leaves some pixels unsorted
	await page.getByTestId('tool-paint').click();
	await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('brush-size').fill('0.08');
	await drag(page, line());
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	await expect(page.getByTestId('strokes')).toContainText('1 brush stroke');
	const painted = await veiled(page);
	expect(painted).toBeGreaterThan(base + 0.05);
	await page.screenshot({ path: 'test-results/brush-paint.png' });
	await page.getByTestId('tool-erase').click();
	await page.getByTestId('brush-size').fill('0.12');
	await drag(page, line());
	await expect(page.getByTestId('stroke')).toHaveCount(2);
	expect(await veiled(page)).toBeLessThan(base + (painted - base) / 4); // the eraser took most of it back
	await page.getByTestId('clear-strokes').click();
	await expect(page.getByTestId('stroke')).toHaveCount(0);
	expect(Math.abs((await veiled(page)) - base)).toBeLessThan(0.01);
});

test('a hand-drawn loop offers to snap into an editable shape, and snapping replaces the stroke', async ({ page }) => {
	await open(page);
	const base = await veiled(page);
	await page.getByTestId('tool-paint').click();
	await drag(page, circle());
	await expect(page.getByTestId('snap')).toContainText('Looks like a');
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	await page.getByTestId('snap-accept').click();
	await expect(page.getByTestId('snap')).toHaveCount(0);
	await expect(page.getByTestId('stroke')).toHaveCount(0); // replaced, not doubled up
	await expect(page.getByTestId('mask-object')).toHaveCount(1);
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	expect(await veiled(page)).toBeGreaterThan(base + 0.05); // and it still protects
	await page.screenshot({ path: 'test-results/brush-snap.png' });
});

test('keeping the stroke dismisses the suggestion and a scribble gets none', async ({ page }) => {
	await open(page);
	await page.getByTestId('tool-paint').click();
	await drag(page, circle());
	await page.getByRole('button', { name: 'Keep my stroke' }).click();
	await expect(page.getByTestId('snap')).toHaveCount(0);
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	await drag(
		page,
		line(40).map(([x, y], i): [number, number] => [x, y + (i % 2 ? 0.08 : -0.08)])
	);
	await expect(page.getByTestId('stroke')).toHaveCount(2);
	await expect(page.getByTestId('snap')).toHaveCount(0);
});

test('painting over a protected shape paints, it does not drag the shape', async ({ page }) => {
	await open(page);
	await page.getByTestId('add-ellipse').click();
	await expect(page.getByTestId('mask-object')).toHaveCount(1);
	const where = () => page.getByTestId('mask-shape').first().boundingBox();
	const before = await where();
	await page.getByTestId('tool-paint').click();
	await drag(page, [
		[0.4, 0.5],
		[0.5, 0.5],
		[0.6, 0.5]
	]);
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	expect(await where()).toEqual(before);
});

test('the brush works on a phone-sized screen too', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await open(page);
	await page.getByTestId('tab-protect').click();
	await page.getByTestId('tool-paint').click();
	await drag(page, line());
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	await page.screenshot({ path: 'test-results/brush-phone.png' });
});
