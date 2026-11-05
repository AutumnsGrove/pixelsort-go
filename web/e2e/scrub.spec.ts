import { expect, test, type Page } from '@playwright/test';

// Scrubbing: drag a slider through the sort. The engine replays deterministically, so the same pass always gives the same
// picture, whichever way you got there.

const picture = (page: Page) =>
	page.getByTestId('stage').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let h = 0;
		for (let i = 0; i < d.length; i += 53) h = (Math.imul(h, 31) + d[i]!) | 0;
		return h;
	});

const scrubTo = async (page: Page, pass: number) => {
	await page.getByTestId('scrub').fill(String(pass));
	await expect(page.getByTestId('scrub')).toHaveAttribute('aria-valuetext', new RegExp(`^pass ${pass} of `));
	await page.waitForTimeout(150); // let the picture land
};

test('the same pass gives the same picture whichever way you got there, and Play carries on from it', async ({
	page
}) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await expect(page.getByTestId('scrub')).toHaveCount(0); // an instant sort has nothing to scrub
	await page.getByTestId('play').click();
	await expect(page.getByTestId('scrub')).toBeVisible();
	await expect
		.poll(async () => Number((await page.getByTestId('scrub').getAttribute('max')) ?? 0), { timeout: 20_000 })
		.toBeGreaterThan(12);
	await page.getByTestId('play').click(); // pause
	await expect(page.getByTestId('state')).toHaveText('paused');
	const max = Number(await page.getByTestId('scrub').getAttribute('max'));
	const mid = Math.floor(max / 2);

	await scrubTo(page, 0);
	const start = await picture(page);
	await scrubTo(page, max);
	const end = await picture(page);
	expect(end).not.toBe(start);
	await scrubTo(page, mid);
	const midFromEnd = await picture(page);
	expect(midFromEnd).not.toBe(start);
	expect(midFromEnd).not.toBe(end);
	await scrubTo(page, 0);
	expect(await picture(page)).toBe(start); // pass 0 is the original again
	await scrubTo(page, mid);
	expect(await picture(page)).toBe(midFromEnd); // forwards or backwards, the same picture
	await page.screenshot({ path: 'test-results/scrub.png' });

	// the keyboard works on the slider too
	await page.getByTestId('scrub').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('scrub')).toHaveAttribute('aria-valuetext', new RegExp(`^pass ${mid + 1} of `));

	// Play carries on from where the slider left it
	await page.getByTestId('play').click();
	await expect(page.getByTestId('state')).toHaveText(/pass|done/);
	await expect
		.poll(async () => Number((await page.getByTestId('scrub').inputValue()) ?? 0), { timeout: 20_000 })
		.toBeGreaterThan(mid + 1);
});

test('scrubbing a finished animation back and forward works, and the last pass is the finished picture', async ({
	page
}) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('play').click();
	await expect(page.getByTestId('scrub')).toBeVisible(); // the animation has really begun (an instant sort also reads "done")
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 60_000 });
	const max = Number(await page.getByTestId('scrub').getAttribute('max'));
	expect(max).toBeGreaterThan(12);
	const finished = await picture(page);
	await scrubTo(page, 3);
	expect(await picture(page)).not.toBe(finished);
	await expect(page.getByTestId('state')).toHaveText('paused');
	await scrubTo(page, max);
	await expect(page.getByTestId('state')).toHaveText('done');
	expect(await picture(page)).toBe(finished); // the last pass is the finished picture
});
