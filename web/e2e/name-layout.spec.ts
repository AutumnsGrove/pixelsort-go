import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The name under the picture, the progress line, the dock and the bottom sheet must never sit on top of one another, at any
// width, and the name must be reachable by touch (a tablet has no F2). Sizes are the ones real devices land on, split view
// included. iPad Safari is WebKit: run these with PLAYWRIGHT_WEBKIT=1 where WebKit is installed (see playwright.config.ts).
const SIZES = [
	['iPad portrait', 768, 1024, true],
	['iPad Air portrait', 820, 1180, true],
	['iPad landscape', 1024, 768, true],
	['split view', 507, 900, true],
	['phone', 390, 844, true],
	['small phone', 360, 640, true],
	['phone landscape', 844, 390, true],
	['desktop', 1440, 900, false],
	['laptop', 1280, 720, false]
] as const;

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, id: string): Promise<Box> => (await page.getByTestId(id).boundingBox())!;
const bottom = (b: Box) => b.y + b.height;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < bottom(b) && b.y < bottom(a);

for (const [label, w, h, touch] of SIZES) {
	test.describe(`${label} ${w}x${h}`, () => {
		test.use({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 800 });

		async function open(page: Page): Promise<void> {
			await page.goto('/studio');
			await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
		}

		test('the name sits below the progress line with a gap, and clear of the dock', async ({ page }) => {
			await open(page);
			const frame = await box(page, 'stage');
			const progress = await box(page, 'progress');
			const name = await box(page, 'name');
			const dock = (await page.getByRole('toolbar', { name: 'Controls' }).boundingBox())!;
			expect(progress.y, 'progress line starts below the picture').toBeGreaterThanOrEqual(bottom(frame) + 4);
			expect(name.y, 'the name starts below the progress line, with room to breathe').toBeGreaterThanOrEqual(
				bottom(progress) + 4
			);
			expect(overlaps(name, dock), 'name and dock').toBe(false);
			expect(overlaps(progress, name), 'progress and name').toBe(false);
			expect(name.x).toBeGreaterThanOrEqual(0);
			expect(name.x + name.width).toBeLessThanOrEqual(w);
			expect(name.height, 'a touch target').toBeGreaterThanOrEqual(44);
		});

		test('a tap opens the name field without moving the picture, and the new name sticks', async ({ page }) => {
			await open(page);
			const before = await box(page, 'stage');
			const dock = (await page.getByRole('toolbar', { name: 'Controls' }).boundingBox())!;
			if (touch) await page.getByTestId('name').tap();
			else await page.getByTestId('name').click();
			const input = page.getByTestId('name-input');
			await expect(input).toBeVisible();
			await expect(input).toBeFocused();
			const after = await box(page, 'stage');
			expect(after, 'no layout shift when the field opens').toEqual(before);
			const edit = (await page.locator('.nm-edit').first().boundingBox())!;
			expect(edit.y, 'the field opens below the progress line, never over the picture').toBeGreaterThanOrEqual(
				bottom(await box(page, 'progress'))
			);
			expect(edit.x).toBeGreaterThanOrEqual(0);
			expect(edit.x + edit.width).toBeLessThanOrEqual(w);
			expect(overlaps(edit, dock), 'the open field never covers the dock').toBe(false);
			await input.fill('  Tablet   ridge ');
			await input.press('Enter');
			await expect(page.getByTestId('name')).toHaveText('Tablet ridge');
		});

		test('no serious accessibility problems with the name field open', async ({ page }) => {
			await open(page);
			await page.getByTestId('name').click();
			await expect(page.getByTestId('name-input')).toBeVisible();
			const results = await new AxeBuilder({ page }).analyze();
			const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
			expect(bad.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
		});

		if (w <= 700) {
			test('with the Pro sheet open the name is in the sheet header, and the caption is not behind the sheet', async ({
				page
			}) => {
				await open(page);
				await page.getByTestId('pro-toggle').click();
				const sheet = await box(page, 'pro');
				const row = page.getByTestId('sheet-name');
				await expect(row).toBeVisible();
				const nb = (await row.boundingBox())!;
				expect(nb.height, '44 px target rule').toBeGreaterThanOrEqual(44);
				expect(nb.y).toBeGreaterThanOrEqual(sheet.y);
				expect(bottom(nb)).toBeLessThanOrEqual(bottom(sheet) + 1);
				const caption = await box(page, 'name');
				expect(bottom(caption), 'the caption sits above the sheet, not behind it').toBeLessThanOrEqual(sheet.y + 1);
				if (touch) await row.tap();
				else await row.click();
				const input = page.getByTestId('sheet-name-input');
				await expect(input).toBeVisible();
				await input.fill('From the sheet');
				await input.press('Enter');
				await expect(page.getByTestId('sheet-name')).toContainText('From the sheet');
				await expect(page.getByTestId('name')).toHaveText('From the sheet');
				const results = await new AxeBuilder({ page }).analyze();
				const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
				expect(bad.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
			});
		}
	});
}

test('F2 still renames from a keyboard', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.keyboard.press('F2');
	await expect(page.getByTestId('name-input')).toBeFocused();
	await page.getByTestId('name-input').fill('Keys');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('name')).toHaveText('Keys');
});

test('Escape in the name field keeps the old name', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	const old = await page.getByTestId('name').innerText();
	await page.getByTestId('name').click();
	await page.getByTestId('name-input').fill('Nope');
	await page.getByTestId('name-input').press('Escape');
	await expect(page.getByTestId('name')).toHaveText(old);
});
