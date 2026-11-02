// Shared helpers for the mockup tests.
// These drive the static mockups in a real headless browser. They need Playwright's Chromium:
//   pnpm install && pnpm exec playwright install chromium
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export { chromium };
export const MOCKUPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** file URL of a mockup page; keeps any ?query: mock('studio.html?pro&shape=hexagon') */
export function mock(file) {
  const [f, q] = file.split('?');
  return pathToFileURL(path.join(MOCKUPS, f)).href + (q ? '?' + q : '');
}

/** absolute path of a file in mockups/shared (for addScriptTag) */
export const shared = (f) => path.join(MOCKUPS, 'shared', f);
