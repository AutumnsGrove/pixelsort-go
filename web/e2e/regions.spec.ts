import { expect, test } from '@playwright/test';

test('Pro panel: cutting the picture into hexagons shows cells and sorts inside them', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();
	await page.getByTestId('shape-hexagon').click();
	await expect(page.getByTestId('class-1')).toBeVisible();
	await expect(page.getByTestId('class-2')).toBeVisible();
	// the overlay is drawn from the engine's label map: some pixels are outlined
	await expect
		.poll(() =>
			page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
				return n;
			})
		)
		.toBeGreaterThan(1000);
	await page.getByLabel('Freeze kind 1').check();
	await expect(page.getByTestId('class-1')).toContainText('frozen');
	await page.waitForTimeout(600);
	await page.screenshot({ path: 'test-results/regions.png' });
	await page.getByTestId('shape-none').click();
	await expect(page.getByTestId('class-1')).toHaveCount(0);
});

test('Protect: the brightest spot becomes a shape that can be removed', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('pro')).toBeVisible();
	await page.getByTestId('brightest').click();
	await expect(page.getByTestId('mask-object')).toHaveCount(1);
	await page.getByRole('button', { name: /^Remove/ }).click();
	await expect(page.getByTestId('mask-object')).toHaveCount(0);
});

test('hold T: the engine says which pixels can move, and the rest are veiled', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	const veiled = () =>
		page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
			const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let n = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i] === 170) n++;
			return n / (d.length / 4);
		});
	// a threshold recipe only moves pixels inside its band, so the rest are held
	await page.getByTestId('k-preset').click();
	await page.locator('.pcard[data-p="kims"]').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('topread')).toContainText('threshold');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	expect(await veiled()).toBe(0); // nothing veiled until T is held
	await page.keyboard.down('t');
	await expect.poll(veiled).toBeGreaterThan(0.01); // the veil is drawn from the engine's own mask
	await page.screenshot({ path: 'test-results/what-can-move.png' });
	await page.keyboard.up('t');
	await expect.poll(veiled).toBe(0);
});

test('Pro panel: Tab toggles it without squeezing the picture; the histogram and the CA rule browser come from the engine', async ({
	page
}) => {
	for (const width of [1024, 1440]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/studio');
		await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
		const before = (await page.getByTestId('stage').boundingBox())!.width;
		await page.keyboard.press('Tab');
		await expect(page.getByTestId('pro')).toBeVisible();
		const after = (await page.getByTestId('stage').boundingBox())!.width;
		expect(after, `picture at ${width}`).toBeGreaterThan(Math.min(before, width) * 0.5); // never a thumbnail
		await page.keyboard.press('Tab');
		await expect(page.getByTestId('pro')).toHaveCount(0);
	}

	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();

	// threshold: a 256-bar histogram and a band
	await page.getByTestId('k-mode').click();
	await page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'threshold', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('histogram').locator('rect')).toHaveCount(257, { timeout: 10_000 }); // 256 bars and the band
	await page.getByRole('slider', { name: 'Band from' }).fill('120');
	await expect(page.getByTestId('histogram')).toBeVisible();

	// cellular automaton: the recommended rules with their notes
	await page.getByTestId('k-mode').click();
	await page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'ca', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('rules-section').locator('button')).toHaveCount(17, { timeout: 10_000 });
	await page.getByTestId('rule-110').click();
	await expect(page.getByTestId('rules-section')).toContainText('Cellular rule 110');
	await expect(page.getByTestId('rule-110')).toContainText('Turing complete');
	await page.screenshot({ path: 'test-results/pro-rules.png' });
});

test('Protect on the canvas: drag a shape, resize it by a corner, rotate it, nudge it, delete it', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await page.getByTestId('add-ellipse').click();
	const shape = page.getByTestId('mask-shape');
	await expect(shape).toHaveCount(1);
	const centre = async () => {
		const b = (await shape.boundingBox())!;
		return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
	};
	const a = await centre();

	// drag it: the shape follows the pointer
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(a.x + 80, a.y + 40, { steps: 5 });
	await page.mouse.up();
	const b = await centre();
	expect(b.x - a.x).toBeGreaterThan(60);
	expect(b.y - a.y).toBeGreaterThan(25);
	await expect(page.getByTestId('mask-handle')).toHaveCount(8); // selected: eight handles and a rotate knob
	await page.screenshot({ path: 'test-results/mask-handles.png' });

	// resize by a corner: bigger
	const corner = (await page.getByTestId('mask-handle').nth(4).boundingBox())!; // bottom-right
	await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
	await page.mouse.down();
	await page.mouse.move(corner.x + 80, corner.y + 60, { steps: 5 });
	await page.mouse.up();
	const c = await centre();
	expect(c.w).toBeGreaterThan(b.w + 40);

	// rotate with the knob: the shape's own transform carries a rotation afterwards
	const knob = (await page.getByTestId('mask-rotate').boundingBox())!;
	await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
	await page.mouse.down();
	await page.mouse.move(knob.x + 300, knob.y + knob.height / 2 + 120, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(() => shape.evaluate((e) => e.parentElement!.getAttribute('transform')!.match(/rotate\(([-\d.]+)\)/)![1]))
		.not.toBe('0');

	// arrow keys nudge, Delete removes
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Delete');
	await expect(page.getByTestId('mask-shape')).toHaveCount(0);
	await expect(page.getByTestId('mask-object')).toHaveCount(0);
});
