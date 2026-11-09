import { describe, expect, it } from 'vitest';
import { pendingFor, type PendingAnimation } from '#lib/animation-save';

const pending: PendingAnimation = { blob: new Blob(['gif']), key: 'look-a', w: 320, h: 200 };

describe('pendingFor', () => {
	it('returns the animation for the look it belongs to', () => {
		expect(pendingFor(pending, 'look-a')).toBe(pending);
	});

	it('drops it when the look has changed', () => {
		expect(pendingFor(pending, 'look-b')).toBeNull();
	});

	it('is null when nothing is waiting', () => {
		expect(pendingFor(null, 'look-a')).toBeNull();
	});
});
