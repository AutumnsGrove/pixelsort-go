import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });

/** A hash of what the preview canvas shows, so two pictures can be told apart. */
const pixelsOf = (page: Page) =>
	page.getByTestId('rule-preview').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let h = 2166136261;
		let on = 0;
		for (let i = 0; i < d.length; i += 4) {
			h = Math.imul(h ^ d[i]!, 16777619) >>> 0;
			if (d[i]! > 128) on++;
		}
		return { hash: h, on, w: c.width, h: c.height };
	});

async function openRules(page: Page): Promise<void> {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('k-mode').click();
	await page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'ca', exact: true }).click();
	await page.keyboard.press('Escape');
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('rules-section').locator('button')).toHaveCount(17, { timeout: 10_000 });
	await expect.poll(async () => (await pixelsOf(page)).on, { timeout: 10_000 }).toBeGreaterThan(100); // drawn by the engine
}

test('the panel shows what the chosen rule looks like, drawn by the engine, and no sort is disturbed', async ({
	page
}) => {
	await openRules(page);
	const first = await pixelsOf(page);
	expect(first.w).toBe(320);
	expect(first.h).toBe(160);
	expect(first.on).toBeLessThan(first.w * first.h); // not a blank white box
	await expect(page.getByTestId('rule-preview-label')).toContainText('Rule 110 · image space');
	await expect(page.getByTestId('rule-preview-unavailable')).toHaveCount(0);
});

test('hovering a rule previews it before it is chosen; leaving goes back; choosing keeps it', async ({ page }) => {
	await openRules(page);
	const chosen = await pixelsOf(page);
	await page.getByTestId('rule-26').hover();
	await expect(page.getByTestId('rule-preview-label')).toContainText('Rule 26');
	await expect(page.getByTestId('rule-preview-label')).toContainText('(hover)');
	await expect.poll(async () => (await pixelsOf(page)).hash).not.toBe(chosen.hash);
	const hovered = await pixelsOf(page);
	// the sort's own recipe has not changed by hovering
	await expect(page.getByTestId('rules-section')).toContainText('Cellular rule 110');
	await page.mouse.move(5, 5);
	await expect(page.getByTestId('rule-preview-label')).not.toContainText('(hover)');
	await expect.poll(async () => (await pixelsOf(page)).hash).toBe(chosen.hash);
	await page.getByTestId('rule-26').click();
	await page.mouse.move(5, 5);
	await expect(page.getByTestId('rules-section')).toContainText('Cellular rule 26');
	await expect.poll(async () => (await pixelsOf(page)).hash).toBe(hovered.hash); // what was hovered is what was chosen
});

test('each rule looks different from the others', async ({ page }) => {
	await openRules(page);
	const seen = new Set<number>();
	for (const r of [26, 110, 45, 154, 106, 41]) {
		await page.getByTestId(`rule-${r}`).hover();
		await expect(page.getByTestId('rule-preview-label')).toContainText(`Rule ${r}`);
		await page.waitForTimeout(250);
		seen.add((await pixelsOf(page)).hash);
	}
	expect(seen.size).toBe(6);
});

test('switching to line space changes the picture and says so; the sort angle turns it', async ({ page }) => {
	await openRules(page);
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('37');
	await page.keyboard.press('Escape');
	await waitDone(page);
	await page.waitForTimeout(300);
	const image = await pixelsOf(page);
	await page.getByTestId('k-mode').click();
	await page.getByRole('button', { name: 'line space' }).click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('rule-preview-label')).toContainText('line space, turning with the 37° direction');
	await expect.poll(async () => (await pixelsOf(page)).hash).not.toBe(image.hash);
	const line37 = await pixelsOf(page);
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('52');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('rule-preview-label')).toContainText('52°');
	await expect.poll(async () => (await pixelsOf(page)).hash).not.toBe(line37.hash);
});

test('a preview that cannot be drawn says so quietly and never blocks the panel', async ({ page }) => {
	await openRules(page);
	// make the engine refuse: the page's own request is answered with an error from a worker we cannot reach, so break the canvas instead
	await page.evaluate(() => {
		const c = document.querySelector('[data-testid="rule-preview"]') as HTMLCanvasElement;
		c.getContext = () => null;
	});
	await page.getByTestId('rule-45').hover();
	await expect(page.getByTestId('rule-preview-unavailable')).toBeVisible();
	await page.getByTestId('rule-45').click(); // the list still works
	await expect(page.getByTestId('rules-section')).toContainText('Cellular rule 45');
});

test('on a phone the preview is in the sheet at full width, the rule buttons stay 44 px, and axe is clean', async ({
	browser
}) => {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await ctx.addInitScript(() => localStorage.setItem('pixelsort.toured', 'true'));
	const page = await ctx.newPage();
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('k-mode').tap();
	await page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'ca', exact: true }).tap();
	await page.keyboard.press('Escape');
	await page.getByTestId('pro-toggle').tap();
	await expect(page.getByTestId('rules-section')).toBeVisible();
	await page.getByTestId('rule-45').tap(); // a tap chooses; there is no hover on touch
	await expect(page.getByTestId('rule-preview-label')).toContainText('Rule 45');
	await expect.poll(async () => (await pixelsOf(page)).on, { timeout: 10_000 }).toBeGreaterThan(100);
	const box = (await page.getByTestId('rule-preview').boundingBox())!;
	expect(box.width).toBeGreaterThan(250);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
	const btn = (await page.getByTestId('rule-110').boundingBox())!;
	expect(btn.height).toBeGreaterThanOrEqual(43.5);
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)
	).toEqual([]);
	await ctx.close();
});
