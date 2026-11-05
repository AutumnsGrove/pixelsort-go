import { expect, test, type Page } from '@playwright/test';

/** A 64x48 gradient with a little noise, as PNG bytes built in the page. */
async function makePng(page: Page): Promise<Buffer> {
	const b64 = await page.evaluate(async () => {
		const c = new OffscreenCanvas(64, 48);
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(64, 48);
		let s = 12345;
		for (let i = 0; i < 64 * 48; i++) {
			s = (s * 1103515245 + 12345) & 0x7fffffff;
			img.data.set([(i % 64) * 4, Math.floor(i / 64) * 5, s & 255, 255], i * 4);
		}
		ctx.putImageData(img, 0, 0);
		const blob = await c.convertToBlob({ type: 'image/png' });
		const buf = new Uint8Array(await blob.arrayBuffer());
		let bin = '';
		for (const b of buf) bin += String.fromCharCode(b);
		return btoa(bin);
	});
	return Buffer.from(b64, 'base64');
}

const pixels = (page: Page, id: string) =>
	page.evaluate((testid) => {
		const c = document.querySelector<HTMLCanvasElement>(`[data-testid=${testid}]`)!;
		return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
	}, id);

test('the lab sorts a picture in the browser', async ({ page }) => {
	await page.goto('/lab');
	await expect(page.getByTestId('isolated')).toHaveText('true');
	await page.getByTestId('file').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: await makePng(page) });
	await expect(page.getByTestId('readout')).toContainText('intervals', { timeout: 15_000 });
	const before = await pixels(page, 'original');
	const after = await pixels(page, 'sorted');
	expect(after).not.toEqual(before);
	const channel = (a: number[]) => {
		const px: string[] = [];
		for (let i = 0; i < a.length; i += 4) px.push(a.slice(i, i + 4).join(','));
		return px.sort();
	};
	expect(channel(after)).toEqual(channel(before)); // a permutation
	await page.screenshot({ path: 'test-results/lab.png', fullPage: true });
});

test('angle 90 with mode none leaves every column monotone by luma', async ({ page }) => {
	await page.goto('/lab');
	await page.getByTestId('file').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: await makePng(page) });
	await expect(page.getByTestId('readout')).toContainText('intervals', { timeout: 15_000 });
	await page.getByLabel('mode').selectOption('none');
	await page.getByLabel('randomness').first().fill('0');
	await page.getByTestId('angle').fill('90');
	await expect(page.getByTestId('readout')).toContainText('64 lines', { timeout: 15_000 });
	await page.waitForTimeout(500);
	const px = await pixels(page, 'sorted');
	const luma = (i: number) => Math.floor((299 * px[i]! + 587 * px[i + 1]! + 114 * px[i + 2]!) / 1000);
	for (let x = 0; x < 64; x++) {
		const col = Array.from({ length: 48 }, (_, y) => luma((y * 64 + x) * 4));
		const asc = col.every((v, i) => i === 0 || col[i - 1]! <= v);
		const desc = col.every((v, i) => i === 0 || col[i - 1]! >= v);
		expect(asc || desc, `column ${x}`).toBe(true);
	}
});

test('a text file shows a visible error', async ({ page }) => {
	await page.goto('/lab');
	await page
		.getByTestId('file')
		.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
	await expect(page.getByRole('alert')).toContainText('not an image');
});
