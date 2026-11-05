import { expect, test, type Page } from '@playwright/test';

async function loadGradient(page: Page): Promise<void> {
	const b64 = await page.evaluate(async () => {
		const c = new OffscreenCanvas(96, 64);
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(96, 64);
		let s = 99;
		for (let i = 0; i < 96 * 64; i++) {
			s = (s * 1103515245 + 12345) & 0x7fffffff;
			img.data.set([(i % 96) * 2, Math.floor(i / 96) * 4, s & 255, 255], i * 4);
		}
		ctx.putImageData(img, 0, 0);
		const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
		let bin = '';
		for (const b of buf) bin += String.fromCharCode(b);
		return btoa(bin);
	});
	await page
		.getByTestId('file')
		.setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
	await expect(page.getByTestId('readout')).toContainText('intervals', { timeout: 15_000 });
}

const canvasHash = (page: Page, id: string) =>
	page.evaluate(async (testid) => {
		const c = document.querySelector<HTMLCanvasElement>(`[data-testid=${testid}]`)!;
		const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		const digest = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	}, id);

for (const algo of ['oddeven', 'insertion', 'merge', 'reveal']) {
	test(`animating with ${algo} ends on the instant result`, async ({ page }) => {
		await page.goto('/lab');
		await loadGradient(page);
		await page.getByLabel('algorithm').selectOption(algo);
		await page.getByRole('button', { name: 'Instant' }).click();
		await expect(page.getByTestId('anim-state')).toHaveText('idle');
		await page.waitForTimeout(300);
		const instant = await canvasHash(page, 'sorted');

		await page.getByRole('checkbox', { name: 'auto' }).check();
		await page.getByRole('button', { name: 'Animate' }).click();
		await expect(page.getByTestId('anim-state')).toHaveText('done', { timeout: 30_000 });
		expect(await canvasHash(page, 'sorted')).toBe(instant);
	});
}

test('pause holds the picture, restart begins again', async ({ page }) => {
	await page.goto('/lab');
	await loadGradient(page);
	await page.getByLabel('algorithm').selectOption('insertion');
	await page.getByLabel('speed').fill('10'); // slow
	await page.getByRole('button', { name: 'Animate' }).click();
	await expect(page.getByTestId('anim-state')).toHaveText('animating');
	await page.getByRole('button', { name: 'Pause' }).click();
	await expect(page.getByTestId('anim-state')).toHaveText('paused');
	// A frame already in flight when Pause was clicked may still land; wait until the canvas stops changing, then check
	// that it stays that way.
	let held = await canvasHash(page, 'sorted');
	for (let stable = 0; stable < 3;) {
		await page.waitForTimeout(250);
		const now = await canvasHash(page, 'sorted');
		stable = now === held ? stable + 1 : 0;
		held = now;
	}
	await page.waitForTimeout(600);
	expect(await canvasHash(page, 'sorted')).toBe(held);
	await page.screenshot({ path: 'test-results/animate-paused.png', fullPage: true });
	await page.getByRole('button', { name: 'Restart' }).click();
	await expect(page.getByTestId('anim-state')).toHaveText('animating');
});
