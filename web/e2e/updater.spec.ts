import { expect, test, type Page } from '@playwright/test';

/** A stand-in for the server plus the host watcher, answering the update endpoints from a tiny state machine. */
async function watcher(
	page: Page,
	opts: { updater?: 'ready' | 'not installed'; available?: boolean; outcome?: 'ok' | 'fail' | 'rollbackfail' } = {}
) {
	const s = {
		version: 'r13.327bb45',
		latest: 'r14.9a1c4e2',
		available: opts.available ?? true,
		updating: false,
		result: null as object | null,
		versionCalls: 0
	};
	await page.route('**/healthz', (r) => r.fulfill({ json: { status: 'ok', version: s.version } }));
	await page.route('**/api/version', (r) => {
		s.versionCalls++;
		return r.fulfill({
			json: {
				version: s.version,
				deployment: 'docker',
				engine_version: '1',
				updater: opts.updater ?? 'ready',
				heartbeat_age_s: 60
			}
		});
	});
	await page.route('**/api/update/available', (r) =>
		r.fulfill({
			json: {
				available: s.available
					? { update_available: true, latest: s.latest, latest_digest: 'sha256:' + 'b'.repeat(64) }
					: { update_available: false },
				check_pending: false
			}
		})
	);
	await page.route('**/api/update/status', (r) => r.fulfill({ json: { pending: s.updating, result: s.result } }));
	await page.route('**/api/update/check', (r) => r.fulfill({ status: 202, json: { ok: true } }));
	await page.route('**/api/update/start', (r) => {
		expect(r.request().postDataJSON()).toEqual({ target: 'latest' });
		s.updating = true;
		s.result = null;
		// the watcher finishes a moment later
		setTimeout(() => {
			s.updating = false;
			const finished_at = new Date().toISOString();
			if (opts.outcome === 'fail')
				s.result = { status: 'failed', detail: 'It did not become healthy.', rollback: 'ok', finished_at };
			else if (opts.outcome === 'rollbackfail')
				s.result = { status: 'failed', detail: 'Nothing started.', rollback: 'failed', finished_at };
			else {
				s.version = s.latest;
				s.available = false;
				s.result = { status: 'ok', target: s.latest, finished_at };
			}
		}, 1500);
		return r.fulfill({ status: 202, json: { ok: true } });
	});
	return s;
}

const state = (page: Page) => page.getByTestId('update-state');

test('an update is available, runs, succeeds and the page reloads on the new version', async ({ page }) => {
	const s = await watcher(page);
	await page.goto('/settings');
	await expect(state(page)).toHaveAttribute('data-kind', 'available');
	await page.getByRole('button', { name: 'Update now' }).click();
	await expect(state(page)).toHaveAttribute('data-kind', 'updating');
	await expect(state(page)).toContainText('Updating. This takes a minute.');
	await expect(state(page)).toHaveAttribute('data-kind', 'done', { timeout: 15_000 });
	await expect(state(page)).toContainText(`Updated to ${s.latest}`);
	await page.waitForEvent('load', { timeout: 10_000 }); // the reload
	await expect(page.getByTestId('updates')).toContainText(`Running ${s.latest}`);
});

test('a failed update says the previous version is back', async ({ page }) => {
	await watcher(page, { outcome: 'fail' });
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Update now' }).click();
	await expect(state(page)).toHaveAttribute('data-kind', 'failed', { timeout: 15_000 });
	await expect(state(page)).toContainText('The previous version is running again.');
	await expect(state(page)).toContainText('It did not become healthy.');
	await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a failed rollback is a different message, with no retry button', async ({ page }) => {
	await watcher(page, { outcome: 'rollbackfail' });
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Update now' }).click();
	await expect(state(page)).toContainText('may not be running properly', { timeout: 15_000 });
	await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('no watcher: "aren’t set up"', async ({ page }) => {
	await watcher(page, { updater: 'not installed' });
	await page.goto('/settings');
	await expect(state(page)).toHaveAttribute('data-kind', 'no_updater');
	await expect(state(page)).toContainText('Updates aren’t set up on this server.');
});

test('up to date: offers Check', async ({ page }) => {
	await watcher(page, { available: false });
	await page.goto('/settings');
	await expect(state(page)).toHaveAttribute('data-kind', 'up_to_date');
	await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible();
});

test('the dot shows on Studio, Archive and Settings while an update waits, and clears after updating', async ({
	page
}) => {
	await watcher(page);
	for (const path of ['/studio', '/archive']) {
		await page.goto(path);
		await expect(page.getByTestId('update-dot')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Settings — an update is ready' })).toBeVisible();
	}
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Update now' }).click();
	await expect(state(page)).toHaveAttribute('data-kind', 'done', { timeout: 15_000 });
	await page.waitForEvent('load', { timeout: 10_000 });
	await expect(state(page)).toHaveAttribute('data-kind', 'up_to_date');
	await expect(page.getByTestId('update-dot')).toHaveCount(0);
});

test('a tab that outlives an update offers a reload', async ({ page }) => {
	const s = await watcher(page, { available: false });
	const first = page.waitForResponse('**/healthz'); // the tab remembers the version it loaded with
	await page.goto('/studio');
	await first;
	await expect(page.getByTestId('stale-banner')).toHaveCount(0);
	s.version = 'r14.9a1c4e2'; // the server moved on while this tab stayed open
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByTestId('stale-banner')).toBeVisible();
	await expect(page.getByTestId('stale-banner')).toContainText('A newer version is ready.');
});
