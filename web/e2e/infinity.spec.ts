import { expect, test, type Page } from '@playwright/test';

// The live loop: with "loop the sort" on, a finished sort turns round and walks back down through the passes to the
// original, then starts again. The rewind is a seek per frame, so the animation keeps its pace in passes and the frame
// rate does what the machine allows.

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
});
