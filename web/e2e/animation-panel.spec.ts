import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

async function openPanel(page: Page): Promise<void> {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('animate').click();
	const panel = page.getByRole('dialog', { name: 'Animate' });
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('anim-loading')).toHaveCount(0, { timeout: 30_000 });
}

/** Make the export small enough that a test finishes quickly. */
async function smallSettings(page: Page): Promise<void> {
	await page.getByRole('button', { name: '25%' }).click();
	await page.getByRole('button', { name: '2s' }).click();
	await page.getByRole('button', { name: '12 fps' }).click();
}

test('the animation panel previews frames and exports a GIF', async ({ page }) => {
	await openPanel(page);

	// The first frame must be drawn on open, before any control is touched.
	const canvas = page.getByTestId('anim-canvas');
	await expect(canvas).toBeVisible();
	const nonBlank = await canvas.evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let sum = 0;
		for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
		return sum > 0 && c.width > 0;
	});
	expect(nonBlank).toBe(true);

	await smallSettings(page);
	await expect(page.getByTestId('anim-info')).toContainText('frames');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/-anim\.gif$/);
	await expect(page.getByTestId('anim-saved')).toContainText('.gif');
});

test('the animation panel exports an APNG at the chosen scale', async ({ page }) => {
	await openPanel(page);
	await smallSettings(page);
	await page.getByRole('radio', { name: 'APNG' }).click();
	await expect(page.getByTestId('anim-info')).toContainText('.apng');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/-anim\.apng$/);
});

test('exports MP4 and WebM when WebCodecs can encode them', async ({ page }) => {
	await openPanel(page);
	await smallSettings(page);

	const mp4 = page.getByRole('radio', { name: 'MP4' });
	await expect(mp4).toBeEnabled();
	await mp4.click();
	const [mp4Download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(mp4Download.suggestedFilename()).toMatch(/\.mp4$/);
	const mp4Bytes = readFileSync((await mp4Download.path())!);
	expect(mp4Bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');

	const webm = page.getByRole('radio', { name: 'WebM' });
	await expect(webm).toBeEnabled();
	await webm.click();
	const [webmDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(webmDownload.suggestedFilename()).toMatch(/\.webm$/);
	const webmBytes = readFileSync((await webmDownload.path())!);
	expect(Array.from(webmBytes.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
});

test('the panel has no accessibility violations', async ({ page }) => {
	await openPanel(page);
	const results = await new AxeBuilder({ page }).include('[data-testid="anim-panel"]').analyze();
	expect(results.violations).toEqual([]);
});

test('an export sends the animation with the saved run', async ({ page }) => {
	let posted = '';
	await page.route('**/api/images/check', (r) => r.fulfill({ json: { exists: false } }));
	await page.route('**/api/runs', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		posted = r.request().postDataBuffer()?.toString('latin1') ?? '';
		return r.fulfill({ status: 201, json: { id: 1 } });
	});
	await openPanel(page);
	await smallSettings(page);
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/\.gif$/);
	await expect(page.getByTestId('anim-saved')).toBeVisible();
	await expect.poll(() => posted).toContain('name="video"');
});

test('an animation does not follow a changed look into a new save', async ({ page }) => {
	const posts: string[] = [];
	await page.route('**/api/images/check', (r) => r.fulfill({ json: { exists: false } }));
	await page.route('**/api/runs', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		posts.push(r.request().postDataBuffer()?.toString('latin1') ?? '');
		if (posts.length === 1) return r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'boom' } } });
		return r.fulfill({ status: 201, json: { id: 2 } });
	});
	await openPanel(page);
	await smallSettings(page);
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/\.gif$/);
	await expect.poll(() => posts.length).toBe(1); // the export's save failed
	await page.getByTestId('anim-close').click();

	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('77');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('save').click();
	await expect.poll(() => posts.length).toBe(2);
	expect(posts[1]).not.toContain('name="video"');
});

test('the preview scrubs, plays and closes without disturbing the studio', async ({ page }) => {
	await openPanel(page);
	const before = await page.getByTestId('state').textContent();
	await page.getByTestId('anim-scrub').fill('3');
	await page.getByTestId('anim-play').click();
	await expect(page.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Pause the preview');
	await page.getByTestId('anim-play').click();
	await page.getByTestId('anim-close').click();
	await expect(page.getByRole('dialog', { name: 'Animate' })).toHaveCount(0);
	await expect(page.getByTestId('state')).toHaveText(before ?? 'done');
});

/** The canvas pixels once the preview has drawn frame `i`. */
async function canvasAt(page: Page, i: number): Promise<number[]> {
	await page.getByTestId('anim-scrub').fill(String(i));
	await expect(page.getByTestId('anim-canvas')).toHaveAttribute('data-frame', String(i));
	return page
		.getByTestId('anim-canvas')
		.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data));
}

/** How far apart two canvases are, summed over every colour channel. */
function distance(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i += 4) {
		sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0)) + Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
		sum += Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
	}
	return sum;
}

test('Infinity sorts and then unsorts back to the original', async ({ page }) => {
	await openPanel(page);
	await smallSettings(page);
	await page.getByRole('radio', { name: 'Infinity' }).click();
	await expect(page.getByTestId('anim-mode')).toContainText('Infinity');

	const frames = Number(await page.getByTestId('anim-scrub').getAttribute('max')) + 1;
	expect(frames).toBeGreaterThan(8);

	const first = await canvasAt(page, 0);
	const middle = await canvasAt(page, Math.floor(frames / 2));
	const last = await canvasAt(page, frames - 1);
	// The last frame is on its way back to the original; halfway through the loop is deep in the sort.
	expect(last).not.toEqual(first);
	expect(distance(last, first)).toBeLessThan(distance(middle, first));

	// Coming back down is a backward seek: it must land on a frame of the loop, not on the one before it.
	const back = await canvasAt(page, frames - 3);
	expect(back).not.toEqual(last);
	expect(back).not.toEqual(first);

	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/-anim\.gif$/);
	await expect(page.getByTestId('anim-saved')).toContainText('.gif');
});

test('the panel remembers its settings for the next visit', async ({ page }) => {
	await openPanel(page);
	await page.getByRole('radio', { name: 'Infinity' }).click();
	await page.getByRole('radio', { name: 'APNG' }).click();
	await page.getByRole('button', { name: '25%' }).click();
	await page.getByRole('button', { name: '2s' }).click();
	await page.getByTestId('anim-close').click();

	await page.reload();
	await openPanel(page);
	await expect(page.getByRole('radio', { name: 'Infinity' })).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByRole('radio', { name: 'APNG' })).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByRole('button', { name: '25%' })).toHaveClass(/on/);
	await expect(page.getByRole('button', { name: '2s' })).toHaveClass(/on/);
});
