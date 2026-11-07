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

test('the brush keeps working with the Pro panel closed, including the strip it covered', async ({ page }) => {
	await open(page);
	await page.getByTestId('tool-paint').click();
	await page.getByTestId('brush-size').fill('0.08');
	await page.getByRole('button', { name: 'Close the Pro panel' }).click();
	await expect(page.getByTestId('pro')).toHaveCount(0);
	await expect(page.getByTestId('protect-bar')).toBeVisible();
	await expect(page.getByTestId('bar-tool-paint')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('brush-exit')).toHaveCount(0); // the pill is only for phones
	const base = await veiled(page);
	// the open panel sits over the right edge of the picture; with it closed the brush reaches there
	await drag(page, [
		[0.84, 0.5],
		[0.88, 0.5],
		[0.92, 0.5]
	]);
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	expect(await veiled(page)).toBeGreaterThan(base + 0.02);
	await page.screenshot({ path: 'test-results/brush-panel-closed.png' });
});

test('P turns the protect brush on, the bar shows it, and undo and clear work from the bar', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.keyboard.press('p');
	await expect(page.getByTestId('pro')).toHaveCount(0);
	await expect(page.getByTestId('protect-bar')).toBeVisible();
	await expect(page.getByTestId('bar-tool-paint')).toHaveAttribute('aria-pressed', 'true');
	await drag(page, line(10));
	await drag(
		page,
		line(10).map(([x, y]): [number, number] => [x, y + 0.05])
	);
	await expect(page.getByTestId('stroke')).toHaveCount(2);
	await page.getByTestId('bar-undo').click();
	await expect(page.getByTestId('stroke')).toHaveCount(1);
	// P again goes back to Move; the bar stays because a stroke is still protected
	await page.keyboard.press('p');
	await expect(page.getByTestId('bar-tool-move')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('protect-bar')).toBeVisible();
	// and it stops the eraser too, instead of just switching it to Paint
	await page.getByTestId('bar-tool-erase').click();
	await expect(page.getByTestId('bar-tool-erase')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('p');
	await expect(page.getByTestId('bar-tool-move')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('bar-clear-strokes').click();
	await expect(page.getByTestId('stroke')).toHaveCount(0);
	await expect(page.getByTestId('protect-bar')).toHaveCount(0);
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

test('pressing the lit tool again puts the brush away, and Done does the same', async ({ page }) => {
	await open(page);
	await page.getByTestId('tool-paint').click();
	await expect(page.getByTestId('brush-layer')).toHaveAttribute('data-tool', 'paint');
	await page.screenshot({ path: 'test-results/brush-done.png' }); // the panel's Done and the bar's Done, side by side
	// the same chip again: the brush goes away instead of staying armed
	await page.getByTestId('tool-paint').click();
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('brush-layer')).toHaveCount(0); // nothing left to paint with
	await drag(page, line(10));
	await expect(page.getByTestId('stroke')).toHaveCount(0); // and a drag paints nothing
	// Erase behaves the same way
	await page.getByTestId('tool-erase').click();
	await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('tool-erase').click();
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	// a chip switches straight between the two brush tools
	await page.getByTestId('tool-paint').click();
	await page.getByTestId('tool-erase').click();
	await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'true');
	// Done in the panel is the explicit way out
	await page.getByTestId('tool-done').click();
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('tool-done')).toHaveCount(0);
	// and so is Done on the compact bar
	await page.getByTestId('tool-paint').click();
	await page.getByTestId('bar-done').click();
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	await drag(page, line(10));
	await expect(page.getByTestId('stroke')).toHaveCount(0);
});

test('Esc stops the brush, but only after whatever is open has been closed', async ({ page }) => {
	await open(page);
	await page.keyboard.press('p');
	await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
	// with a popover open, Esc closes it and leaves the brush alone: one layer at a time
	await page.getByTestId('k-preset').click();
	await expect(page.locator('.pop').first()).toBeVisible();
	await page.keyboard.press('p');
	await page.keyboard.press('Escape');
	await expect(page.locator('.pop').first()).toHaveCount(0);
	await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
});

test('on a phone a closed sheet leaves a Done pill over the picture, and it stops the brush', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await page.getByTestId('tab-protect').click();
	await page.getByTestId('tool-paint').click();
	await expect(page.getByTestId('brush-exit')).toHaveCount(0); // while the sheet is open its own chips are right there
	await page.getByRole('button', { name: 'Close the Pro panel' }).click();
	const pill = page.getByTestId('brush-exit');
	await expect(pill).toBeVisible();
	const box = (await pill.boundingBox())!;
	expect(box.height, 'a thumb can hit it').toBeGreaterThanOrEqual(43.5);
	const stage = (await page.getByTestId('stage').boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(stage.x - 0.5);
	expect(box.x + box.width, 'the pill sits inside the picture').toBeLessThanOrEqual(stage.x + stage.width + 0.5);
	await expect(page.getByTestId('protect-bar')).toBeHidden(); // the bar stays a desktop thing
	await page.screenshot({ path: 'test-results/brush-phone-exit.png' });
	await drag(page, line(10));
	await expect(page.getByTestId('stroke')).toHaveCount(1); // the brush is still on until Done
	await pill.click();
	await expect(pill).toHaveCount(0);
	await drag(page, line(10));
	await expect(page.getByTestId('stroke')).toHaveCount(1); // and is off afterwards
});

test('a window too short for the bar keeps the picture its size and floats Done on it', async ({ page }) => {
	await page.setViewportSize({ width: 844, height: 390 }); // a phone held sideways: wide, but with no spare height
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	const before = (await page.getByTestId('stage').boundingBox())!;
	await page.keyboard.press('p');
	const pill = page.getByTestId('brush-exit');
	await expect(pill).toBeVisible();
	await expect(page.getByTestId('protect-bar')).toBeHidden();
	const after = (await page.getByTestId('stage').boundingBox())!;
	expect(after.height, 'no bar row is reserved, so the picture does not shrink').toBeCloseTo(before.height, 0);
	await page.screenshot({ path: 'test-results/brush-short-window.png' });
	await pill.click();
	await expect(pill).toHaveCount(0);
});
