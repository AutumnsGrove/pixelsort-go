import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// The Shape helper's "Ask": the server is faked here (there is no model in the test), so what this checks is the page: the
// first-use notice, what is sent, how the transcript reads, that the page cuts the shape out itself, and every way it can fail.
// The real wire (Go server, Nova, OpenRouter) is covered by the Go tests and by the live run recorded in docs/dev/NOTES.md.

async function discPicture(page: Page): Promise<Buffer> {
	const b64 = await page.evaluate(async () => {
		const c = new OffscreenCanvas(1200, 800);
		const g = c.getContext('2d')!;
		g.fillStyle = 'rgb(40,80,50)';
		g.fillRect(0, 0, 1200, 800);
		g.fillStyle = 'rgb(200,60,30)';
		g.beginPath();
		g.arc(600, 400, 190, 0, Math.PI * 2);
		g.fill();
		const blob = await c.convertToBlob({ type: 'image/png' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let s = '';
		for (const x of bytes) s += String.fromCharCode(x);
		return btoa(s);
	});
	return Buffer.from(b64, 'base64');
}

const ev = (...events: object[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
const PROPOSED = ev(
	{ type: 'start', model: 'test/vision' },
	{ type: 'tool_start', id: 'a', name: 'list_objects' },
	{ type: 'tool_end', id: 'a', name: 'list_objects', ms: 41 },
	{ type: 'tool_start', id: 'b', name: 'propose_shape' },
	{ type: 'tool_end', id: 'b', name: 'propose_shape', ms: 7 },
	{
		type: 'proposal',
		proposal: {
			region: 'r1',
			name: 'Red disc',
			seed_x: 0.5,
			seed_y: 0.5,
			tolerance: 28,
			area_pct: 17.7,
			colour: '#c83c1e'
		}
	},
	{ type: 'say', text: 'That is the red disc in the middle.' },
	{ type: 'done', reason: 'proposed' }
);
const ndjson = (body: string) => ({ status: 200, contentType: 'application/x-ndjson', body });
const refusal = (status: number, code: string, message: string) => ({
	status,
	contentType: 'application/json',
	body: JSON.stringify({ error: { code, message } })
});

/** Opens Studio with the disc picture and the helper turned on at the (fake) server. `answer` is what /api/helper does. */
async function open(
	page: Page,
	answer: (route: Route) => Promise<void> | void,
	opts: { helper?: boolean } = {}
): Promise<{ bodies: Buffer[] }> {
	const bodies: Buffer[] = [];
	await page.route('**/api/features', (r) =>
		r.fulfill({ json: { share: false, fetch: false, helper: opts.helper ?? true } })
	);
	await page.route('**/api/helper', async (r) => {
		bodies.push(r.request().postDataBuffer() ?? Buffer.alloc(0));
		await answer(r);
	});
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: await discPicture(page) });
	await expect(page.getByTestId('topread')).toContainText('1200×800', { timeout: 30_000 });
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('helper-section')).toBeVisible();
	return { bodies };
}

const ask = async (page: Page, text = 'the red disc') => {
	await page.getByTestId('helper-prompt').fill(text);
	await page.getByTestId('helper-ask-go').click();
};

/** The width and height written in a JPEG's frame header. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
	for (let i = 2; i + 9 < buf.length;) {
		if (buf[i] !== 0xff) return null;
		const m = buf[i + 1]!;
		if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
			return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
		i += 2 + buf.readUInt16BE(i + 2);
	}
	return null;
}

test('the first request shows a notice and sends nothing until it is accepted', async ({ page }) => {
	const { bodies } = await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page);
	await expect(page.getByTestId('helper-notice')).toContainText('send');
	await expect(page.getByTestId('helper-notice')).toContainText('never sent');
	expect(bodies).toHaveLength(0);
	await page.getByTestId('helper-notice-no').click();
	await expect(page.getByTestId('helper-notice')).toHaveCount(0);
	expect(bodies).toHaveLength(0); // "Not now" really is not now
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	expect(bodies).toHaveLength(1);
});

test('the notice is once per device: the second ask goes straight through', async ({ page }) => {
	const { bodies } = await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await ask(page, 'again');
	await expect(page.getByTestId('helper-notice')).toHaveCount(0);
	await expect.poll(() => bodies.length).toBe(2);
	await page.reload();
	await page.waitForFunction(() => document.querySelector('[data-testid=state]')?.textContent === 'done');
	await page.getByTestId('pro-toggle').click();
	await ask(page, 'after a reload');
	await expect(page.getByTestId('helper-notice')).toHaveCount(0); // it is remembered on this device
});

test('only a small copy of the picture leaves: a JPEG of at most 512 px, with the prompt and nothing else', async ({
	page
}) => {
	const { bodies } = await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page, 'the red disc');
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	const body = bodies[0]!;
	const text = body.toString('latin1');
	const fields = [...text.matchAll(/form-data; name="([^"]+)"/g)].map((m) => m[1]).sort();
	expect(fields).toEqual(['image', 'prompt']);
	expect(text).toContain('the red disc');
	const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
	expect(start).toBeGreaterThan(0);
	const size = jpegSize(body.subarray(start))!;
	expect(Math.max(size.w, size.h)).toBe(512); // 1200x800 comes down to 512x341
	expect(size.w / size.h).toBeCloseTo(1.5, 1);
	expect(body.length).toBeLessThan(150_000);
	expect(text).not.toContain('Exif');
	expect(text).not.toContain('disc.png'); // not even the file name
});

test('the transcript says what it did; the page cuts the shape out itself; nothing is added until Use it', async ({
	page
}) => {
	await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	const t = page.getByTestId('helper-transcript');
	await expect(t).toContainText('Listing what is in it');
	await expect(t).toContainText('Choosing a shape');
	await expect(t).toContainText('41 ms');
	await expect(page.getByTestId('helper-say')).toContainText('red disc in the middle');
	await expect(page.getByTestId('helper-name')).toHaveValue('Red disc'); // the model's name, not the colour guess
	await expect(page.getByTestId('helper-tol-v')).toHaveText('28');
	const info = await page.getByTestId('helper-info').innerText();
	const pct = Number(/([\d.]+)% of the picture/.exec(info)![1]);
	expect(pct).toBeGreaterThan(11); // the engine measured the disc itself: pi * 190^2 / (1200 * 800) = 11.8%
	expect(pct).toBeLessThan(12.6);
	await expect(page.getByTestId('my-shape')).toHaveCount(0);
	await page.getByTestId('helper-use').click();
	await expect(page.getByTestId('my-shape')).toHaveCount(1);
	await expect(page.getByTestId('my-shape')).toHaveAttribute('title', /Red disc/);
});

test('it fails in words and leaves the page usable: busy, cannot see, unreachable, cut off', async ({ page }) => {
	let mode = 'busy';
	await open(page, async (r) => {
		if (mode === 'busy') await r.fulfill(refusal(429, 'busy', 'The helper is busy.'));
		else if (mode === 'blind') await r.fulfill(refusal(422, 'no_vision', 'x does not accept pictures.'));
		else if (mode === 'dead') await r.abort('connectionrefused');
		else await r.fulfill(ndjson(ev({ type: 'start' }, { type: 'tool_start', id: 'a' })));
	});
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-note')).toContainText('busy');
	mode = 'blind';
	await ask(page, 'again');
	await expect(page.getByTestId('helper-note')).toContainText('cannot see pictures');
	await expect(page.getByTestId('helper-note')).toContainText('Cut out this object');
	mode = 'dead';
	await ask(page, 'again');
	await expect(page.getByTestId('helper-note')).toContainText('Could not reach the server');
	mode = 'cut';
	await ask(page, 'again');
	await expect(page.getByTestId('helper-note')).toContainText('cut off');
	await expect(page.getByTestId('helper-result')).toHaveCount(0); // nothing was added by any of these
	await expect(page.getByTestId('my-shape')).toHaveCount(0);
	// and the manual cut-out still works
	await page.getByTestId('helper-bright').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
});

test('when nothing matches, the helper’s own words are shown and no shape appears', async ({ page }) => {
	await open(page, (r) =>
		r.fulfill(
			ndjson(
				ev(
					{ type: 'start' },
					{ type: 'say', text: 'There is no dog in this picture.' },
					{ type: 'done', reason: 'answered' }
				)
			)
		)
	);
	await ask(page, 'the dog');
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-say')).toContainText('no dog');
	await expect(page.getByTestId('helper-result')).toHaveCount(0);
});

test('Stop ends a run that is waiting, says so, and nothing is added', async ({ page }) => {
	let release: () => void = () => {};
	const held = new Promise<void>((res) => (release = res));
	await open(page, async (r) => {
		await held;
		await r.abort().catch(() => {});
	});
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-stop')).toBeVisible();
	await expect(page.getByTestId('helper-prompt')).toBeDisabled();
	await page.getByTestId('helper-stop').click();
	await expect(page.getByTestId('helper-note')).toHaveText('Stopped. Nothing was added.');
	await expect(page.getByTestId('helper-ask-go')).toBeVisible(); // ready to ask again
	release();
});

test('a server without the helper shows no Ask at all, and says so in Settings', async ({ page }) => {
	await open(page, (r) => r.fulfill(ndjson(PROPOSED)), { helper: false });
	await expect(page.getByTestId('helper-pick')).toBeVisible(); // Cut out is still there
	await expect(page.getByTestId('helper-ask')).toHaveCount(0);
	await page.goto('/settings');
	await expect(page.getByTestId('helper-status')).toContainText('not set up on this server');
	await expect(page.getByTestId('helper-notice-again')).toHaveCount(0);
});

test('Settings can show the notice again', async ({ page }) => {
	await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	await page.goto('/settings');
	await expect(page.getByTestId('helper-status')).toContainText('is on');
	await page.getByTestId('helper-notice-again').click();
	await expect(page.getByTestId('helper-notice-again')).toBeDisabled();
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('pro-toggle').click();
	await ask(page);
	await expect(page.getByTestId('helper-notice')).toBeVisible();
});

test('axe finds nothing serious with the notice and a transcript showing', async ({ page }) => {
	await open(page, (r) => r.fulfill(ndjson(PROPOSED)));
	await ask(page);
	await expect(page.getByTestId('helper-notice')).toBeVisible();
	let results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
		[]
	);
	await page.getByTestId('helper-notice-ok').click();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
		[]
	);
});

test('on a phone: the prompt and buttons are big enough to tap, and the whole flow works by touch', async ({
	browser
}) => {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await ctx.addInitScript(() => localStorage.setItem('pixelsort.toured', 'true'));
	const page = await ctx.newPage();
	await page.route('**/api/features', (r) => r.fulfill({ json: { share: false, fetch: false, helper: true } }));
	await page.route('**/api/helper', (r) => r.fulfill(ndjson(PROPOSED)));
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: await discPicture(page) });
	await expect(page.getByTestId('topread')).toContainText('1200×800', { timeout: 30_000 });
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('pro-toggle').tap();
	await page.getByTestId('helper-ask').scrollIntoViewIfNeeded();
	await page.getByTestId('helper-prompt').fill('the red disc');
	const go = page.getByTestId('helper-ask-go');
	expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
	expect((await go.boundingBox())!.width).toBeGreaterThanOrEqual(80); // a button, not a dot
	await go.tap();
	await expect(page.getByTestId('helper-notice-ok')).toBeInViewport(); // the notice scrolls itself into view
	for (const id of ['helper-notice-ok', 'helper-notice-no']) {
		expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(43.5);
	}
	await page.getByTestId('helper-notice-ok').tap();
	await expect(page.getByTestId('helper-result')).toBeVisible();
	const box = (await page.getByTestId('helper-ask').boundingBox())!;
	expect(box.x + box.width).toBeLessThanOrEqual(390.5); // nothing sticks out sideways
	await ctx.close();
});
