import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The live loop: with "loop the sort" on, a finished sort turns round and walks back down through the passes to the
// original, then starts again. The rewind is a seek per frame, so the animation keeps its pace in passes and the frame
// rate does what the machine allows.

/** A stand-in gallery API that counts the runs it is asked to store and keeps their multipart parts. */
async function fakeGallery(page: Page): Promise<{ saves: () => number; parts: () => Record<string, Buffer> }> {
	let saves = 0;
	let parts: Record<string, Buffer> = {};
	await page.route('**/api/images/check', (r) => r.fulfill({ json: { exists: false } }));
	await page.route('**/api/runs', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		saves++;
		parts = multipart(r.request().postDataBuffer()!, r.request().headers()['content-type'] ?? '');
		return r.fulfill({ status: 201, json: { id: saves } });
	});
	return { saves: () => saves, parts: () => parts };
}

/** The parts of a multipart upload, by field name. Binary-safe: every part is kept as raw bytes. */
function multipart(body: Buffer, contentType: string): Record<string, Buffer> {
	const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
	if (!boundary) return {};
	const out: Record<string, Buffer> = {};
	for (const chunk of body.toString('latin1').split(`--${boundary}`)) {
		const name = /name="([^"]+)"/.exec(chunk)?.[1];
		const start = chunk.indexOf('\r\n\r\n');
		if (!name || start < 0) continue;
		out[name] = Buffer.from(chunk.slice(start + 4, chunk.lastIndexOf('\r\n')), 'latin1');
	}
	return out;
}

const studio = async (page: Page) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
};

const PASS = /^pass \d+$/;
// Speed is passes a second: 20 makes a leg of the default sample a few seconds, so the turn is easy to catch.
const SPEED = 60;

test.beforeEach(() => test.setTimeout(90_000));
const scrubPass = async (page: Page) => Number(await page.getByTestId('scrub').inputValue());

/** The Watch popover holds the algorithm, the speed and the loop. */
const watch = async (page: Page) => {
	await page.getByRole('button', { name: /Watch as/ }).click();
	await expect(page.getByTestId('loop')).toBeVisible();
};
const closePopover = (page: Page) => page.keyboard.press('Escape');

/** Export the picture as PNG and answer its bytes: the same recipe encodes to the same file every time. */
async function exportPng(page: Page): Promise<Buffer> {
	await page.getByTestId('export').click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
	const path = await download.path();
	await page.keyboard.press('Escape'); // the export popover would sit over the dock
	return readFileSync(path!);
}

const playAt = async (page: Page, speed: number, loop: boolean) => {
	await watch(page);
	await page.getByLabel('Speed').fill(String(speed));
	if (loop) await page.getByTestId('loop').check();
	await closePopover(page);
	await page.getByTestId('play').click();
};

/** Pause and wait for the frame that was already in flight: only then is the picture really held. */
const pausePlayback = async (page: Page) => {
	await page.getByTestId('play').click();
	await expect(page.getByTestId('state')).toHaveText('paused');
	await expect
		.poll(async () => {
			const a = await scrubPass(page);
			await page.waitForTimeout(200);
			return (await scrubPass(page)) === a;
		})
		.toBe(true);
};

test('with the loop on the sort comes back to the original and starts again', async ({ page }) => {
	await studio(page);
	const sorted = await page.getByTestId('state').textContent();
	expect(sorted).toBe('done');

	await playAt(page, SPEED, true);
	await expect(page.getByTestId('state')).toHaveText(PASS);
	await expect
		.poll(async () => Number((await page.getByTestId('scrub').getAttribute('max')) ?? 0), { timeout: 30_000 })
		.toBeGreaterThan(12);

	// The end of the sort turns the animation round instead of stopping it.
	await expect(page.getByTestId('state')).toHaveText('rewinding', { timeout: 60_000 });
	const high = await scrubPass(page);
	await expect.poll(() => scrubPass(page), { timeout: 30_000 }).toBeLessThan(high);
	// Play still means pause: the loop is one animation, not a finished one.
	await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause');

	// Home again, and off it goes in the other direction.
	await expect(page.getByTestId('state')).toHaveText(PASS, { timeout: 60_000 });
	await expect.poll(() => scrubPass(page), { timeout: 30_000 }).toBeLessThan(high);
	await expect.poll(() => scrubPass(page), { timeout: 30_000 }).toBeGreaterThan(1); // it did not stop on the original: it is sorting again
});

test('pausing a rewind holds the picture, and turning the loop off finishes the trip home', async ({ page }) => {
	// Auto-save on, so a stop at the original is offered every chance to store the unsorted picture by mistake.
	await page.addInitScript(() => localStorage.setItem('pixelsort.settings', JSON.stringify({ autoSave: true })));
	const api = await fakeGallery(page);
	await studio(page);
	await playAt(page, SPEED, true);
	await expect(page.getByTestId('state')).toHaveText('rewinding', { timeout: 60_000 });

	await pausePlayback(page); // pause mid-rewind
	const held = await scrubPass(page);
	await page.waitForTimeout(400);
	expect(await scrubPass(page)).toBe(held);
	// Loop off, then on with the animation: it finishes the way home and stops on the original.
	await watch(page);
	await page.getByTestId('loop').uncheck();
	await closePopover(page);
	await page.getByTestId('play').click(); // resume
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 60_000 });
	expect(await scrubPass(page)).toBe(0);
	// The finished sort is still the whole sort: the scrubber's end did not move.
	expect(Number(await page.getByTestId('scrub').getAttribute('max'))).toBeGreaterThan(12);
	// Stopping on the original is not a finished sort, and auto-save must not store it as one.
	await page.waitForTimeout(3500);
	expect(api.saves(), 'storing the unsorted picture').toBe(0);

	// A deliberate Save at that point still stores the *result*, not the original the canvas happens to show: with the
	// same encoder, storing the original would make the two parts byte-for-byte equal.
	await page.getByTestId('save').click();
	await expect.poll(() => api.saves(), { timeout: 15_000 }).toBe(1);
	const parts = api.parts();
	expect(parts.result?.byteLength ?? 0).toBeGreaterThan(0);
	expect(Buffer.compare(parts.result!, parts.original!)).not.toBe(0);
});

test('Export after a loop comes home still means the finished sort, and a replay means what it shows', async ({
	page
}) => {
	await studio(page);
	// The reference: the finished sort (Studio opens on it), exported the plain way. The stepped sort reaches exactly
	// these pixels, so the same recipe encodes to the same bytes.
	const sorted = await exportPng(page);

	// Now the same picture, looped and stopped on the original: the download must still be that finished sort.
	await playAt(page, SPEED, true);
	await expect(page.getByTestId('state')).toHaveText('rewinding', { timeout: 60_000 });
	await watch(page);
	await page.getByTestId('loop').uncheck();
	await closePopover(page);
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 60_000 });
	expect(await scrubPass(page)).toBe(0); // the canvas is on the original
	expect(Buffer.compare(await exportPng(page), sorted), 'the original exported instead of the sort').toBe(0);

	// Start over replays from the beginning: paused mid-way, the picture on screen is what Save and Export mean.
	await page.getByRole('button', { name: 'Start over' }).click();
	await expect.poll(() => scrubPass(page), { timeout: 30_000 }).toBeGreaterThan(3);
	await pausePlayback(page);
	expect(Buffer.compare(await exportPng(page), sorted), 'a stale finished sort came back').not.toBe(0);
});
