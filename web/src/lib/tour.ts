// The first-run tour: what it says, where its card goes, and whether it has been seen. Pure, so it is tested without a
// browser; Tour.svelte draws it. Port of the tour in mockups/shared/help.js.
import { LocalStorageBackend, type KeyValueStore } from './storage';

export const TOURED_KEY = 'pixelsort.toured';

export type TourStep = { target: string; title: string; body: string };

/** Each target is a real element on the Studio page. */
export const STEPS: readonly TourStep[] = [
	{
		target: '[data-testid="stage"]',
		title: 'Your picture',
		body: 'This is the picture being sorted. Drop or paste any picture to replace it; hold C to see the original.'
	},
	{
		target: '[data-testid="k-preset"]',
		title: 'Start from a look',
		body: 'Presets are starting points. Pick one, then roll it again for a different version.'
	},
	{
		target: '[data-testid="k-mode"]',
		title: 'Which pixels move',
		body: 'The intervals decide which stretches of pixels get sorted. Hold T to see exactly which can move.'
	},
	{
		target: '[data-testid="play"]',
		title: 'Watch it happen',
		body: 'Play shows the sort unfolding, step by step. Pause any time.'
	},
	{
		target: '[data-testid="pro-toggle"]',
		title: 'More control',
		body: 'Pro opens regions and protected shapes: cut the picture into cells and give each its own sort.'
	},
	{
		target: '[data-testid="export"]',
		title: 'Keep it',
		body: 'Save the picture at the size you want. Everything is also kept in the Archive.'
	}
];

export function seen(store: KeyValueStore = new LocalStorageBackend()): boolean {
	return store.get(TOURED_KEY) === true;
}
export function markSeen(store: KeyValueStore = new LocalStorageBackend()): void {
	store.set(TOURED_KEY, true);
}

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Where the card goes: below the target if it fits, else above, else centred; always inside the screen with a margin,
 * so it fits a phone as well as a desktop.
 */
export function placeCard(
	target: Rect | null,
	card: { width: number; height: number },
	view: { width: number; height: number },
	margin = 12
): { left: number; top: number } {
	const w = Math.min(card.width, view.width - 2 * margin);
	const clampX = (x: number) => Math.max(margin, Math.min(x, view.width - w - margin));
	const clampY = (y: number) => Math.max(margin, Math.min(y, view.height - card.height - margin));
	if (!target) return { left: clampX((view.width - w) / 2), top: clampY((view.height - card.height) / 2) };
	const gap = 14;
	const below = target.top + target.height + gap;
	const above = target.top - gap - card.height;
	const left = clampX(target.left + target.width / 2 - w / 2);
	if (below + card.height <= view.height - margin) return { left, top: clampY(below) };
	if (above >= margin) return { left, top: clampY(above) };
	return { left, top: clampY((view.height - card.height) / 2) };
}
