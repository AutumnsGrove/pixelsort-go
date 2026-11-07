import { expect, test } from 'vitest';
import { add, dropHidden, range, selectAll, summarize, toggle } from './selection';

const ids = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);

test('toggle adds and removes one id without changing what it was given', () => {
	const before = new Set([1, 2]);
	const added = toggle(before, 3);
	const removed = toggle(before, 1);
	expect(ids(added)).toEqual([1, 2, 3]);
	expect(ids(removed)).toEqual([2]);
	expect(ids(before)).toEqual([1, 2]); // the caller's set is untouched
});

test('add leaves an already picked id alone and returns a new set', () => {
	const before = new Set([1]);
	expect(ids(add(before, 2))).toEqual([1, 2]);
	expect(ids(add(before, 1))).toEqual([1]);
	const again = add(before, 1);
	expect(again).not.toBe(before);
});

test('range selects the inclusive visible span, forwards and backwards', () => {
	const visible = [10, 20, 30, 40];
	expect(ids(range(visible, new Set(), 20, 40))).toEqual([20, 30, 40]);
	expect(ids(range(visible, new Set(), 40, 20))).toEqual([20, 30, 40]);
	expect(ids(range(visible, new Set([10]), 20, 30))).toEqual([20, 30]); // a plain shift-click replaces
});

test('an additive range keeps what was already picked', () => {
	const visible = [10, 20, 30, 40];
	expect(ids(range(visible, new Set([10]), 20, 30, true))).toEqual([10, 20, 30]);
});

test('range with no anchor, or a hidden anchor, selects the clicked id', () => {
	expect(ids(range([10, 20, 30], new Set([10]), null, 20))).toEqual([20]);
	expect(ids(range([10, 20, 30], new Set([10]), 99, 20))).toEqual([20]);
	expect(ids(range([10, 20, 30], new Set([10]), 99, 20, true))).toEqual([10, 20]);
});

test('selectAll selects only what is visible', () => {
	expect(ids(selectAll([1, 2, 3]))).toEqual([1, 2, 3]);
	expect(ids(selectAll([]))).toEqual([]);
});

test('dropHidden removes ids that are no longer shown and keeps the same set when nothing changed', () => {
	const picked = new Set([1, 2, 3]);
	expect(ids(dropHidden(picked, [2, 3, 4]))).toEqual([2, 3]);
	const same = dropHidden(picked, [1, 2, 3, 4]);
	expect(same).toBe(picked);
});

test('summarize counts each selected run once, including starred and shared ones', () => {
	const runs = [
		{ id: 1, starred: true },
		{ id: 2, starred: false },
		{ id: 3, starred: true }
	];
	const summary = summarize(new Set([1, 2, 3, 9]), runs, new Set([2, 3]));
	expect(summary).toEqual({ count: 3, starred: 2, shared: 2 });
	expect(summarize(new Set(), runs, new Set())).toEqual({ count: 0, starred: 0, shared: 0 });
});
