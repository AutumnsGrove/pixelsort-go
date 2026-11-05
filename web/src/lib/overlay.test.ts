import { expect, test } from 'vitest';
import { classColor, overlayPixels } from './overlay';

test('edges between labels are outlined; cell interiors are tinted by class; gaps stay clear', () => {
	// 4x1: gap, cell 1 (class 2), cell 1, cell 2 (class 1)
	const labels = new Uint16Array([0, 1, 1, 2]);
	const classOf = new Uint8Array([0, 2, 1]);
	const px = overlayPixels(labels, classOf, 4, 1);
	const alpha = (x: number) => px[x * 4 + 3];
	expect(alpha(0)).toBe(150); // the gap touches cell 1: an edge pixel
	expect(alpha(1)).toBe(46); // interior of cell 1, tinted
	expect([px[4], px[5], px[6]]).toEqual(classColor(2));
	expect(alpha(2)).toBe(150); // cell 1 meets cell 2
	expect(alpha(3)).toBe(46);
});

test('size and unknown classes never throw', () => {
	const px = overlayPixels(new Uint16Array(6), new Uint8Array(1), 3, 2);
	expect(px).toHaveLength(24);
	expect(classColor(99)).toEqual(classColor(0));
	expect(() => overlayPixels(new Uint16Array([5, 5]), new Uint8Array(0), 2, 1)).not.toThrow();
});
