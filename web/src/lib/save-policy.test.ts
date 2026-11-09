import { describe, expect, test } from 'vitest';
import { ApiError } from './api';
import { autoSaveAllowed, createLeaveGuard, resultPixels, saveButton, saveFailureReason } from './save-policy';

describe('when a run is saved by itself', () => {
	test('only when the setting is on and the picture is not the bundled demo', () => {
		expect(autoSaveAllowed({ autoSave: false, isSample: false })).toBe(false); // the default: nothing is stored until Save
		expect(autoSaveAllowed({ autoSave: true, isSample: true })).toBe(false); // the demo is never stored by itself
		expect(autoSaveAllowed({ autoSave: true, isSample: false })).toBe(true);
		expect(autoSaveAllowed({ autoSave: false, isSample: true })).toBe(false);
	});
});

describe('the Save button', () => {
	test('says what pressing it does, and is off while it cannot do it', () => {
		expect(saveButton('unsaved', false)).toMatchObject({ label: 'Save', disabled: false });
		expect(saveButton('saved', false)).toMatchObject({ label: 'Saved', disabled: false }); // pressing again is a no-op, not an error
		expect(saveButton('saving', false)).toMatchObject({ label: 'Saving…', disabled: true });
		expect(saveButton('failed', false)).toMatchObject({ label: 'Retry save', disabled: false });
	});
	test('is off while the sort is still running, because the picture on screen is not the finished look', () => {
		for (const s of ['unsaved', 'saved', 'failed'] as const) {
			const b = saveButton(s, true);
			expect(b.disabled, s).toBe(true);
			expect(b.title, s).toMatch(/sort/i);
		}
	});
	test('every state has a title for a hover or a screen reader', () => {
		for (const s of ['unsaved', 'saved', 'saving', 'failed'] as const)
			expect(saveButton(s, false).title.length).toBeGreaterThan(8);
	});
});

describe('leaving with unsaved changes warns once and never blocks', () => {
	test('the first attempt warns, the second goes through', () => {
		const g = createLeaveGuard();
		expect(g.check(true, 'a')).toBe('warn');
		expect(g.check(true, 'a')).toBe('allow');
	});
	test('nothing to lose means no warning', () => {
		const g = createLeaveGuard();
		expect(g.check(false, 'a')).toBe('allow');
	});
	test('a further change after the warning earns a new warning', () => {
		const g = createLeaveGuard();
		expect(g.check(true, 'a')).toBe('warn');
		expect(g.check(true, 'b')).toBe('warn');
		expect(g.check(true, 'b')).toBe('allow');
	});
	test('saving in between resets it', () => {
		const g = createLeaveGuard();
		expect(g.check(true, 'a')).toBe('warn');
		expect(g.check(false, 'a')).toBe('allow');
		expect(g.check(true, 'a')).toBe('warn');
	});
});

describe('why a save failed', () => {
	test('a full disk and a timeout are named; anything else is left unsaid', () => {
		expect(saveFailureReason(new ApiError(507, 'insufficient_storage', 'full'))).toBe('disk');
		expect(saveFailureReason(new ApiError(408, 'timeout', 'slow'))).toBe('timeout');
		expect(saveFailureReason(new ApiError(500, 'internal', 'boom'))).toBeUndefined();
		expect(saveFailureReason(new TypeError('Failed to fetch'))).toBeUndefined();
		expect(saveFailureReason('weird')).toBeUndefined();
	});
});

describe('resultPixels', () => {
	test('prefers the finished sort kept from the frame that reported it', () => {
		const shown = new Uint8ClampedArray([1, 2, 3, 4]);
		const sorted = new Uint8ClampedArray([9, 9, 9, 9]);
		expect(resultPixels(shown, sorted)).toBe(sorted);
	});

	test('falls back to the picture on screen', () => {
		const shown = new Uint8ClampedArray([1, 2, 3, 4]);
		expect(resultPixels(shown, null)).toBe(shown);
		expect(resultPixels(null, null)).toBeNull();
	});
});
