import { expect, test, type Page } from '@playwright/test';

// The shape library in Studio's Pro panel. Ports of the browser parts of mockups/tests/custom-shapes.mjs,
// shape-holes.mjs and shape-tidy.mjs. The preview server has no gallery API, so saved shapes use the browser fallback.

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const CIRCLE = svg('<circle cx="50" cy="50" r="40"/>');
const DONUT = svg('<path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/>');
const MIXED = svg('<path d="M0 0 H60 V60 H0 Z M15 15 V45 H45 V15 Z M80 80 H100 V100 H80 Z"/>');
const SMALLHOLE = svg('<path d="M0 0 H100 V100 H0 Z M45 45 V55 H55 V45 Z"/>');
const TWOEL = svg('<rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="20"/>');

async function openLibrary(page: Page): Promise<void> {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('shape-library')).toBeVisible();
	await expect(page.getByTestId('starter-Ring')).toBeVisible();
}

const inked = (page: Page) =>
	page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
		return n;
	});

const paste = async (page: Page, text: string) => {
	const box = page.getByTestId('svg-text');
	if (!(await box.isVisible())) await page.getByText('Add your own from an SVG').click();
	await box.fill(text);
	await page.getByTestId('svg-read').click();
};
const stats = (page: Page) => page.getByTestId('tidy-stats');

test('the library has eleven starters and each one tiles the picture', async ({ page }) => {
	await openLibrary(page);
	await expect(page.getByRole('group', { name: 'Starter shapes' }).getByRole('button')).toHaveCount(11);
	for (const name of ['Star', 'Ring', 'Frame', 'Target']) {
		await page.getByTestId(`starter-${name}`).click();
		await expect(page.getByTestId(`starter-${name}`)).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => inked(page), { message: name }).toBeGreaterThan(500);
	}
	await page.screenshot({ path: 'test-results/shape-library.png' });
});

test('stagger the rows changes the cells', async ({ page }) => {
	await openLibrary(page);
	await page.getByTestId('starter-Cross').click();
	await expect.poll(() => inked(page)).toBeGreaterThan(500);
	const before = await page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => c.toDataURL());
	await page.getByRole('switch', { name: 'Stagger the rows' }).check();
	await expect
		.poll(() => page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => c.toDataURL()))
		.not.toBe(before);
});

test('a plain shape goes straight in; a donut opens the tidy panel', async ({ page }) => {
	await openLibrary(page);
	await paste(page, CIRCLE);
	await expect(page.getByTestId('tidy')).toHaveCount(0);
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	await paste(page, DONUT);
	await expect(page.getByTestId('tidy')).toBeVisible();
	await expect(stats(page)).toContainText('1 hole');
	await expect(page.getByTestId('tidy-pieces')).toHaveCount(0); // one piece: no choice
	await expect(page.getByTestId('my-shape')).toHaveCount(1); // nothing added until you say so
	await page.getByRole('switch', { name: 'Keep the holes' }).uncheck();
	await expect(stats(page)).not.toContainText('hole');
	await expect(stats(page)).toContainText('1 ring left out');
	await page.getByRole('switch', { name: 'Keep the holes' }).check();
	await expect(stats(page)).toContainText('1 hole');
	await page.getByTestId('tidy-cancel').click();
	await expect(page.getByTestId('tidy')).toHaveCount(0);
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
});

test('tidy options: small holes, which pieces, simplify', async ({ page }) => {
	await openLibrary(page);
	await paste(page, SMALLHOLE);
	await expect(stats(page)).toContainText('1 hole');
	await page.getByRole('slider', { name: 'Fill holes smaller than' }).fill('0.05');
	await expect(stats(page)).not.toContainText(' hole');
	await page.getByTestId('tidy-cancel').click();

	await paste(page, TWOEL);
	await expect(page.getByTestId('tidy-pieces')).toBeVisible();
	await expect(stats(page)).not.toContainText('hole');
	await page.getByRole('button', { name: 'all of them' }).click();
	await expect(stats(page)).toContainText('1 hole');
	await page.getByTestId('tidy-cancel').click();

	await paste(page, MIXED);
	await expect(page.getByTestId('tidy-pieces')).toHaveCount(0); // one element, even with several sub-paths
	await expect(stats(page)).toContainText('2 pieces, 1 hole');
	const points = async () => Number((await stats(page).innerText()).match(/(\d+) points/)![1]);
	const p0 = await points();
	await page.getByRole('slider', { name: 'Simplify' }).fill('0.15');
	await expect.poll(points).toBeLessThan(p0);
	expect(await points()).toBeGreaterThanOrEqual(9); // every ring stays
});

test('adding a tidied shape saves it, uses it, and it survives a reload', async ({ page }) => {
	await openLibrary(page);
	await paste(page, DONUT);
	await page.getByRole('textbox', { name: 'Shape name' }).fill('Donut');
	await page.getByTestId('tidy-add').click();
	await expect(page.getByTestId('tidy')).toHaveCount(0);
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	await expect(page.getByTestId('my-shape')).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => inked(page)).toBeGreaterThan(500);
	await page.reload();
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByRole('button', { name: 'Donut', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Delete Donut' }).click();
	await expect(page.getByTestId('my-shape')).toHaveCount(0);
});

test('dropping an SVG file adds a shape and does not replace the picture', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	const sizeBefore = await page.getByTestId('stage').evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`);
	const nameBefore = await page.getByTestId('name').innerText();
	await page.evaluate((text) => {
		const dt = new DataTransfer();
		dt.items.add(new File([text], 'blob.svg', { type: 'image/svg+xml' }));
		window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
	}, CIRCLE);
	await expect(page.getByTestId('pro')).toBeVisible(); // it opened the Pro panel's library
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	expect(await page.getByTestId('stage').evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`)).toBe(sizeBefore);
	await expect(page.getByTestId('name')).toHaveText(nameBefore);
});

test('a hostile SVG becomes a shape and runs nothing', async ({ page }) => {
	await openLibrary(page);
	const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1" viewBox="0 0 100 100">
		<script>window.__pwned = 2</script>
		<circle cx="50" cy="50" r="40" onclick="window.__pwned=3"/>
		<image href="javascript:window.__pwned=4"/></svg>`;
	await paste(page, evil);
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test('bad input gets a plain message', async ({ page }) => {
	await openLibrary(page);
	await paste(page, '<svg><path');
	await expect(page.getByTestId('svg-error')).toHaveText('That doesn’t parse as SVG.');
	await paste(page, svg('<text>hi</text>'));
	await expect(page.getByTestId('svg-error')).toContainText('No shapes in there');
});
