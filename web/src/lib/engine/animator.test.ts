import { describe, expect, test } from 'vitest';
import { adaptAuto, fixedSteps, MAX_STEPS_PER_FRAME } from './animator';

describe('fixedSteps', () => {
	test.each([
		// dt s, speed, carry in -> steps, carry out
		[0.016, 60, 0, 0, 0.96],
		[0.016, 60, 0.96, 1, 0.92],
		[0.1, 24, 0, 2, 0.4],
		[1, 24, 0, 2, 0.4], // dt is capped at 100 ms
		[0, 100, 0.5, 0, 0.5],
		[-1, 100, 0, 0, 0] // time going backwards does nothing
	])('dt %f speed %f carry %f', (dt, speed, carry, steps, rest) => {
		const r = fixedSteps(dt, speed, carry);
		expect(r.steps).toBe(steps);
		expect(r.carry).toBeCloseTo(rest, 6);
	});

	test('never more than 300 steps in a frame, and the excess is dropped', () => {
		const r = fixedSteps(0.1, 100000, 0);
		expect(r).toEqual({ steps: MAX_STEPS_PER_FRAME, carry: 0 });
	});
});

describe('adaptAuto', () => {
	test('speeds up when a batch is quick, slows down when it is slow', () => {
		expect(adaptAuto(10, 4)).toBeGreaterThan(10);
		expect(adaptAuto(10, 60)).toBeLessThan(10);
	});
	test('settles near one frame', () => {
		let n = 1;
		for (let i = 0; i < 30; i++) n = adaptAuto(n, n * 0.5); // each step costs 0.5 ms
		expect(n).toBeGreaterThanOrEqual(30);
		expect(n).toBeLessThanOrEqual(34);
	});
	test('never changes by more than x2 per frame, stays in 1..300', () => {
		expect(adaptAuto(10, 0.001)).toBe(20);
		expect(adaptAuto(10, 10000)).toBe(5);
		expect(adaptAuto(1, 10000)).toBe(1);
		expect(adaptAuto(300, 0.001)).toBe(300);
	});
});
