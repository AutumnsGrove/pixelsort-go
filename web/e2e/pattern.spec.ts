import { expect, test } from '@playwright/test';

/** How many cells the card says kind 1 has: it comes from the engine's own class map, so a change means a new map. */
async function kindOneCounts(page: import('@playwright/test').Page): Promise<string> {
	return (await page.getByTestId('class-1').locator('.count').innerText()).trim();
}

test('Pro panel: a pattern is a shape, so it draws cells, sorts inside them and shows the region cards', async ({
	page
}) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();

	// a pattern is chosen where a hexagon is: the same row of shapes under "Cut the picture into"
	await page.getByTestId('shape-pattern').click();
	await expect(page.getByTestId('pattern-section')).toBeVisible();
	await expect(page.getByTestId('pattern-preview-label')).toContainText('truchet / arc');
	// the preview is drawn by the engine's own tessellation code: some cells are drawn
	await expect
		.poll(() =>
			page.getByTestId('pattern-preview').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				for (let i = 0; i < d.length; i += 4) if (d[i]! > 100) n++;
				return n;
			})
		)
		.toBeGreaterThan(100);

	// the shape brings its cells and the cards that go with them, like any other shape
	await expect(page.getByTestId('class-1')).toBeVisible();
	await expect(page.getByTestId('class-2')).toBeVisible();
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
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	const lobes = await kindOneCounts(page);

	// the drawing's own knobs live in the same section and still reach the picture
	await page.getByTestId('pattern-family-grid').click();
	await page.getByTestId('pattern-variant-iso').click();
	await expect(page.getByTestId('pattern-preview-label')).toContainText('grid / iso');
	await expect.poll(() => kindOneCounts(page)).not.toBe(lobes);
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

	// inverting makes the drawn lines the cells, which is a different region map: fewer, joined shapes
	const cells = await kindOneCounts(page);
	await page.getByTestId('pattern-invert').check();
	await expect(page.getByTestId('pattern-preview-label')).toContainText('lines are the cells');
	await expect.poll(() => kindOneCounts(page)).not.toBe(cells);
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.screenshot({ path: 'test-results/pattern.png' });

	// and the pattern is a shape, so picking another shape replaces it
	await page.getByTestId('shape-hexagon').click();
	await expect(page.getByTestId('pattern-section')).toHaveCount(0);
	await expect(page.getByTestId('class-1')).toBeVisible();
	await expect.poll(() => kindOneCounts(page)).not.toBe(cells);
});
