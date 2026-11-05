import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Port of mockups/tests/layout-scan.mjs: every route at every size, nothing overflows sideways and nothing the user needs
// falls off the screen. Plus an accessibility scan (axe) of each route.
const SIZES = [
	[840, 627],
	[1024, 720],
	[1280, 800],
	[1366, 768],
	[1440, 900],
	[1920, 1080],
	[390, 844]
] as const;
const ROUTES = ['/', '/studio', '/archive', '/settings'];

async function settle(page: Page, path: string): Promise<void> {
	await page.goto(path);
	if (path === '/studio') await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	else await page.waitForTimeout(250);
}

for (const [w, h] of SIZES) {
	test(`layout at ${w}x${h}: no sideways scroll, controls inside the screen`, async ({ page }) => {
		await page.setViewportSize({ width: w, height: h });
		for (const path of ROUTES) {
			await settle(page, path);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, `${path} at ${w}x${h}`).toBeLessThanOrEqual(0);
		}
		// Studio: the dock and every dock button sit inside the screen
		await settle(page, '/studio');
		const dock = (await page.getByRole('toolbar', { name: 'Controls' }).boundingBox())!;
		expect(dock.x).toBeGreaterThanOrEqual(-0.5);
		expect(dock.x + dock.width).toBeLessThanOrEqual(w + 0.5);
		expect(dock.y + dock.height).toBeLessThanOrEqual(h + 0.5);
		const stage = (await page.getByTestId('stage').boundingBox())!;
		expect(stage.width).toBeGreaterThan(Math.min(w, 300) * 0.5); // never squeezed to a thumbnail
		expect(stage.y + stage.height).toBeLessThanOrEqual(dock.y + 1); // the picture does not run under the dock
	});
}

test('layout with every popover and dialog open at 1280x800 and 390x844', async ({ page }) => {
	for (const [w, h] of [
		[1280, 800],
		[390, 844]
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await settle(page, '/studio');
		for (const id of ['k-preset', 'k-mode', 'k-angle']) {
			await page.getByTestId(id).click();
			const pop = page.locator('.pop').first();
			await expect(pop).toBeVisible();
			const b = (await pop.boundingBox())!;
			expect(b.x, `${id} at ${w}`).toBeGreaterThanOrEqual(-0.5);
			expect(b.x + b.width, `${id} at ${w}`).toBeLessThanOrEqual(w + 0.5);
			expect(b.y).toBeGreaterThanOrEqual(-0.5);
			await page.keyboard.press('Escape');
		}
		await page.getByTestId('export').click();
		const card = (await page.locator('.er-card').boundingBox())!;
		expect(card.x + card.width).toBeLessThanOrEqual(w + 0.5);
		expect(card.y + card.height).toBeLessThanOrEqual(h + 0.5);
		await page.keyboard.press('Escape');
	}
});

for (const path of ROUTES) {
	test(`accessibility: ${path} has no serious or critical violations`, async ({ page }) => {
		await settle(page, path);
		const results = await new AxeBuilder({ page }).analyze();
		const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
		expect(
			bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 120)}`),
			path
		).toEqual([]);
	});
}

test('accessibility: Studio with the Pro panel, the link box and the tour open', async ({ page }) => {
	await settle(page, '/studio');
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();
	await page.getByTestId('shape-hexagon').click();
	let results = await new AxeBuilder({ page }).analyze();
	let bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(
		bad.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.html.slice(0, 120)}`),
		'pro panel'
	).toEqual([]);

	await page.getByTestId('link-open').click();
	results = await new AxeBuilder({ page }).analyze();
	bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(
		bad.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.html.slice(0, 120)}`),
		'link box'
	).toEqual([]);
});
