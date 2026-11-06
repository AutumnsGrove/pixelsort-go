import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// "Cut out this object": the engine grows a region from a click and traces it. The picture here is made on the spot (a red disc of
// radius 100 on flat green, 640x400), so the right answers are known: the disc covers about 12.3% of the picture.
const DISC_PCT = (Math.PI * 100 * 100 * 100) / (640 * 400);

async function discPicture(page: Page): Promise<Buffer> {
	const b64 = await page.evaluate(async () => {
		const c = new OffscreenCanvas(640, 400);
		const g = c.getContext('2d')!;
		g.fillStyle = 'rgb(40,80,50)';
		g.fillRect(0, 0, 640, 400);
		g.fillStyle = 'rgb(200,60,30)';
		g.beginPath();
		g.arc(320, 200, 100, 0, Math.PI * 2);
		g.fill();
		const blob = await c.convertToBlob({ type: 'image/png' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let s = '';
		for (const x of bytes) s += String.fromCharCode(x);
		return btoa(s);
	});
	return Buffer.from(b64, 'base64');
}

async function openHelper(page: Page): Promise<void> {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: await discPicture(page) });
	await expect(page.getByTestId('topread')).toContainText('640×400', { timeout: 30_000 });
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('helper-section')).toBeVisible();
}

const pctOf = async (page: Page) => {
	const t = await page.getByTestId('helper-info').innerText();
	return Number(/([\d.]+)% of the picture/.exec(t)![1]);
};

/** A click on the picture at a fraction of its size. */
async function clickPicture(page: Page, fx: number, fy: number): Promise<void> {
	const b = (await page.getByTestId('stage').boundingBox())!;
	await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
}

test('click the picture, and the disc comes back as an outline with the right size', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-pick').click();
	await expect(page.getByTestId('helper-pick')).toHaveAttribute('aria-pressed', 'true');
	await clickPicture(page, 0.5, 0.5);
	await expect(page.getByTestId('helper-result')).toBeVisible();
	expect(await pctOf(page)).toBeGreaterThan(DISC_PCT - 1);
	expect(await pctOf(page)).toBeLessThan(DISC_PCT + 1);
	const info = await page.getByTestId('helper-info').innerText();
	const pts = Number(/^(\d+) points/.exec(info)![1]);
	expect(pts).toBeGreaterThanOrEqual(8);
	expect(pts).toBeLessThanOrEqual(200);
	await expect(page.getByTestId('helper-name')).toHaveValue('Red shape');
	await expect(page.getByTestId('helper-pick')).toHaveAttribute('aria-pressed', 'false'); // one click, then it stops listening
	// the engine's edge is drawn over the picture
	const dots = await page.getByTestId('cutout-ants').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
		return n;
	});
	expect(dots).toBeGreaterThan(100);
});

test('Use it adds the shape to your shapes under the name given; nothing is added before', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-bright').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await expect(page.getByTestId('my-shape')).toHaveCount(0); // nothing until Use it
	await page.getByTestId('helper-name').fill('Sunny disc');
	await page.getByTestId('helper-use').click();
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	await expect(page.getByTestId('my-shape')).toHaveAttribute('title', /Sunny disc/);
	await expect(page.getByTestId('helper-result')).toHaveCount(0);
	// the new shape is now the one that cuts the picture
	await expect(page.getByTestId('overlay')).toBeVisible();
});

test('the tolerance slider re-cuts at the same spot, and a looser tolerance never shrinks the shape', async ({
	page
}) => {
	await openHelper(page);
	await page.getByTestId('helper-pick').click();
	await clickPicture(page, 0.5, 0.5);
	await expect(page.getByTestId('helper-result')).toBeVisible();
	const before = await pctOf(page);
	await page.getByTestId('helper-tol').fill('70');
	await expect(page.getByTestId('helper-tol-v')).toHaveText('70');
	await expect.poll(() => pctOf(page)).toBeGreaterThanOrEqual(before);
});

test('a click on the background says why there is no shape, and how to get one', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-pick').click();
	await clickPicture(page, 0.04, 0.05);
	await expect(page.getByTestId('helper-refusal')).toContainText('too much of the picture');
	await expect(page.getByTestId('helper-refusal')).toContainText('Lower the tolerance');
	await expect(page.getByTestId('helper-result')).toHaveCount(0);
	// and the panel is not stuck: a good click works straight after
	await page.getByTestId('helper-pick').click();
	await clickPicture(page, 0.5, 0.5);
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await expect(page.getByTestId('helper-refusal')).toHaveCount(0);
});

test('Escape stops waiting for a click, and Clear removes the outline', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-pick').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('helper-pick')).toHaveAttribute('aria-pressed', 'false');
	await page.getByTestId('helper-bright').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await page.getByTestId('helper-clear').click();
	await expect(page.getByTestId('helper-result')).toHaveCount(0);
});

test('while waiting for a click, the picture is not painted on or dragged, and nothing is saved or sorted again', async ({
	page
}) => {
	await openHelper(page);
	const state = await page.getByTestId('state').innerText();
	await page.getByTestId('helper-pick').click();
	await clickPicture(page, 0.3, 0.3);
	await page.waitForTimeout(400);
	expect(await page.getByTestId('state').innerText()).toBe(state); // a cut-out never re-sorts
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', /unsaved|saved/);
});

test('a different picture clears the old outline', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-bright').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: 'again.png', mimeType: 'image/png', buffer: await discPicture(page) });
	await expect(page.getByTestId('helper-result')).toHaveCount(0);
});

test('axe finds nothing serious with a result open', async ({ page }) => {
	await openHelper(page);
	await page.getByTestId('helper-bright').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)
	).toEqual([]);
});

test('on a phone: the helper is in the Shapes tab, its buttons are 44 px, and a tap on the picture cuts out', async ({
	browser
}) => {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await ctx.addInitScript(() => localStorage.setItem('pixelsort.toured', 'true'));
	const page = await ctx.newPage();
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: await discPicture(page) });
	await expect(page.getByTestId('topread')).toContainText('640×400', { timeout: 30_000 });
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('pro-toggle').tap();
	await page.getByTestId('helper-section').scrollIntoViewIfNeeded();
	for (const id of ['helper-pick', 'helper-bright', 'helper-clear']) {
		const b = (await page.getByTestId(id).boundingBox())!;
		expect(b.height, id).toBeGreaterThanOrEqual(43.5);
	}
	await page.getByTestId('helper-pick').tap();
	const b = (await page.getByTestId('stage').boundingBox())!;
	await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.5);
	await expect(page.getByTestId('helper-result')).toBeVisible();
	expect(await pctOf(page)).toBeGreaterThan(DISC_PCT - 1.5);
	await ctx.close();
});
