import { expect, test, type Page } from '@playwright/test';

// The SVG reader measures with the browser's own geometry, so these run in a real page (the /lab/svg harness).
// Ports of the parsing and starter assertions of mockups/tests/shape-holes.mjs.

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const DONUT = svg('<path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/>');
const TWO = svg('<path d="M0 0 H40 V40 H0 Z M60 60 H100 V100 H60 Z"/>');
const TWOEL = svg('<rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="20"/>');
const MIXED = svg('<path d="M0 0 H60 V60 H0 Z M15 15 V45 H45 V15 Z M80 80 H100 V100 H80 Z"/>');
const RELATIVE = svg('<path d="m0 0 h50 v50 h-50 z m10 10 v30 h30 v-30 z"/>');
const CIRCLE = svg('<circle cx="50" cy="50" r="40"/>');

async function lab(page: Page): Promise<void> {
	await page.goto('/lab/svg');
	await expect(page.getByTestId('svg-lab')).toHaveText('ready');
}

/** Read an SVG string and build it, returning only plain data. */
const build = (page: Page, text: string, opts: object = {}) =>
	page.evaluate(
		([t, o]) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const L = (globalThis as any).svgLab;
			const r = L.readSvg(t as string);
			if (r.error) return { error: r.error as string };
			const s = L.buildShape(r.raw, o);
			return {
				stats: s.stats,
				info: s.info,
				more: s.more.length,
				pieces: r.raw.pieces.length,
				tidy: L.needsTidy(r.raw)
			};
		},
		[text, opts] as const
	);

test('rings and nesting come out as the mockup says', async ({ page }) => {
	await lab(page);
	const donut = await build(page, DONUT);
	expect(donut).toMatchObject({ pieces: 1, more: 1, stats: { holes: 1, pieces: 1 } });
	expect(await build(page, RELATIVE)).toMatchObject({ stats: { holes: 1 } }); // relative sub-paths split correctly
	expect(await build(page, TWO)).toMatchObject({ stats: { pieces: 2, holes: 0 } });
	expect(await build(page, MIXED)).toMatchObject({ stats: { pieces: 2, holes: 1 } });
	expect(await build(page, TWOEL)).toMatchObject({ pieces: 2 });
	expect(await build(page, TWOEL, { pieces: 'largest' })).toMatchObject({ stats: { holes: 0, rings: 1 } });
	expect(await build(page, TWOEL, { pieces: 'all' })).toMatchObject({ stats: { holes: 1, rings: 2 } });
	expect(await build(page, DONUT, { holes: false })).toMatchObject({ stats: { holes: 0, droppedRings: 1 } });
	expect(await build(page, CIRCLE)).toMatchObject({ tidy: false });
	expect(await build(page, DONUT)).toMatchObject({ tidy: true });
});

test('the three error messages', async ({ page }) => {
	await lab(page);
	expect(await build(page, '<svg><path')).toEqual({ error: 'That doesn’t parse as SVG.' });
	expect(await build(page, '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toEqual({
		error: 'No <svg> found in that file.'
	});
	expect(await build(page, svg('<text>hi</text>'))).toMatchObject({
		error: expect.stringContaining('No shapes in there')
	});
	expect(await build(page, svg('<path d="M0 0"/>'))).toEqual({ error: 'Couldn’t measure any outline in that SVG.' });
});

test('starter shapes: ring counts and nesting', async ({ page }) => {
	await lab(page);
	const counts = await page.evaluate(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const L = (globalThis as any).svgLab;
		return L.STARTERS.map((s: { name: string }, i: number) => [s.name, L.starterShape(i).more.length] as const);
	});
	expect(counts).toHaveLength(11);
	const extra = Object.fromEntries(counts);
	expect(extra).toMatchObject({ Ring: 1, Frame: 1, Target: 2 });
	// only the compound starters carry extra rings
	for (const [name, n] of counts) if (!['Ring', 'Frame', 'Target'].includes(name)) expect(n, name).toBe(0);
});

test('a hostile SVG yields shapes and runs nothing', async ({ page }) => {
	await lab(page);
	const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1" viewBox="0 0 100 100">
		<script>window.__pwned = 2</script>
		<circle cx="50" cy="50" r="40" onclick="window.__pwned=3" onload="window.__pwned=4"/>
		<rect width="30" height="30"><set attributeName="x" to="1" onbegin="window.__pwned=5"/></rect>
		<foreignObject><iframe srcdoc="&lt;script&gt;parent.__pwned=6&lt;/script&gt;"></iframe></foreignObject>
		<image href="javascript:window.__pwned=7"/>
	</svg>`;
	const result = await build(page, evil, { pieces: 'all' });
	expect(result).toMatchObject({ pieces: 2 });
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
	// and nothing from the file is left in the page
	expect(await page.locator('script[src], iframe, foreignObject, image').count()).toBe(0);
	expect(await page.evaluate(() => document.querySelectorAll('svg').length)).toBe(0);
});

test('the file size cap refuses a huge file before parsing', async ({ page }) => {
	await lab(page);
	const r = await page.evaluate(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (globalThis as any).svgLab.readSvg('<svg>' + ' '.repeat(2_000_001) + '</svg>');
	});
	expect(r.error).toContain('too big');
});
