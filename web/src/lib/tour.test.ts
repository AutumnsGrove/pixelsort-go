import { expect, test } from 'vitest';
import { LocalStorageBackend } from './storage';
import { markSeen, placeCard, seen, STEPS } from './tour';

const memory = () => {
	const m = new Map<string, string>();
	return new LocalStorageBackend(() => ({
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k)
	}));
};

test('first run is detected from storage, and finishing or skipping remembers it', () => {
	const s = memory();
	expect(seen(s)).toBe(false);
	markSeen(s);
	expect(seen(s)).toBe(true);
});

test('every step has a target, a title and a body', () => {
	expect(STEPS.length).toBeGreaterThanOrEqual(4);
	for (const st of STEPS) expect(st.target && st.title && st.body).toBeTruthy();
});

test('the card always fits the screen, from a phone to a desktop', () => {
	const sizes = [
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1280, height: 720 },
		{ width: 1920, height: 1080 }
	];
	const targets = [
		null,
		{ left: 0, top: 0, width: 40, height: 40 },
		{ left: 350, top: 800, width: 40, height: 40 },
		{ left: 100, top: 300, width: 600, height: 300 }
	];
	for (const view of sizes)
		for (const t of targets) {
			const card = { width: 320, height: 160 };
			const p = placeCard(t, card, view);
			const w = Math.min(card.width, view.width - 24);
			expect(p.left).toBeGreaterThanOrEqual(12);
			expect(p.left + w).toBeLessThanOrEqual(view.width - 12 + 0.001);
			expect(p.top).toBeGreaterThanOrEqual(12);
			expect(p.top + card.height).toBeLessThanOrEqual(view.height - 12 + 0.001);
		}
});

test('the card goes below the target when it fits and above when it does not', () => {
	const view = { width: 1000, height: 800 };
	const card = { width: 300, height: 120 };
	expect(placeCard({ left: 400, top: 100, width: 100, height: 50 }, card, view).top).toBeGreaterThan(150);
	expect(placeCard({ left: 400, top: 700, width: 100, height: 50 }, card, view).top).toBeLessThan(700);
});
