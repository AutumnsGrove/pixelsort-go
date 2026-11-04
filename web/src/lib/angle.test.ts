import { expect, test } from 'vitest';
import { fromPointer, snap15, wrap } from './angle';

test('pointer at the four cardinal points gives 0, 90, 180, 270', () => {
	expect(fromPointer(0, 0, 10, 0)).toBe(0);
	expect(fromPointer(0, 0, 0, -10)).toBe(90); // up on screen is smaller y
	expect(fromPointer(0, 0, -10, 0)).toBe(180);
	expect(fromPointer(0, 0, 0, 10)).toBe(270);
});
test('wrap', () => {
	expect([wrap(-1), wrap(360), wrap(725), wrap(0)]).toEqual([359, 0, 5, 0]);
});
test('snap15', () => {
	expect([snap15(7), snap15(8), snap15(350), snap15(359)]).toEqual([0, 15, 345, 0]);
});
