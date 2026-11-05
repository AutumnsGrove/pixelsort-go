import { describe, expect, test } from 'vitest';
import { MAX, clean, fileName, resolve, sanitizeAll, suggest } from './naming';
import { filename } from './export-model';

describe('clean', () => {
	test('line breaks and tabs become one space, ends trimmed', () =>
		expect(clean('  Sunset \n ridge\t')).toBe('Sunset ridge'));
	test('control and direction-override characters are removed', () => expect(clean('a\u0000b‮evil​')).toBe('a b evil'));
	test('never throws on odd input', () => {
		expect(clean(null)).toBe('');
		expect(clean(undefined)).toBe('');
		expect(clean(42)).toBe('42');
		expect(clean({})).toBe('[object Object]');
	});
	test(`capped at ${MAX}`, () => expect(Array.from(clean('x'.repeat(100))).length).toBe(MAX));
	test('an emoji on the boundary is kept whole or dropped, never split', () => {
		const c = clean('a'.repeat(MAX - 1) + '😀😀');
		expect(c).not.toMatch(/[\ud800-\udbff]$/);
		expect(Array.from(c).length).toBeLessThanOrEqual(MAX);
	});
	test('keeps ordinary punctuation (escaped when shown, not stripped)', () =>
		expect(clean('<b>hi</b> & "you"')).toBe('<b>hi</b> & "you"'));
});

describe('resolve', () => {
	test('an empty entry goes back to the automatic name', () =>
		expect(resolve('   ', 'Ridge, wave')).toEqual({ name: 'Ridge, wave', kept: false, cleared: true }));
	test('with no fallback a name is never blank', () => expect(resolve('', '').name).toBe('Untitled'));
	test('a real entry is kept, tidied', () =>
		expect(resolve(' Dusk ', 'x')).toEqual({ name: 'Dusk', kept: true, cleared: false }));
});

describe('suggest', () => {
	test('stable, always "Word, mode", no placeholders for odd params', () => {
		for (const p of [
			{ mode: 'random', seed: 3 },
			{ mode: 'ca', rule: 110, seed: 5 },
			{ mode: 'threshold' },
			{},
			null,
			{ mode: 'weird', seed: 'x' as unknown as number }
		]) {
			const a = suggest(p);
			expect(a).toBe(suggest(p));
			expect(a).not.toMatch(/undefined|NaN|null|\[object/);
			expect(a).toMatch(/^[A-Z][a-z]+, \w/);
		}
	});
	test('a cellular run names its rule', () => expect(suggest({ mode: 'ca', rule: 110 })).toMatch(/cellular 110$/));
});

describe('fileName', () => {
	test('identical to what the export dialog produces', () => {
		for (const [n, r, f, t] of [
			['Sunset ridge', 'threshold', 'png', '0f3a'],
			['Ünï / côde:', 'ca', 'jpeg', ''],
			['', '', 'webp', ''],
			['***', 'x', 'bogus', '1']
		] as const)
			expect(fileName(n, r, f, t)).toBe(filename(n, r, f, t));
	});
	test('the recipe is added unless the name already says it', () => {
		expect(fileName('Ridge, threshold', 'threshold', 'png', '0f3a')).toBe('ridge-threshold-0f3a.png');
		expect(fileName('Dusk', 'threshold', 'png', '0f3a')).toBe('dusk-threshold-0f3a.png');
	});
	test('no path or reserved characters, ever', () =>
		expect(fileName('a/b\\c:d*e?f"g<h>i|j k', 'r', 'png', 't')).not.toMatch(/[/\\:*?"<>|\s]/));
});

describe('sanitizeAll', () => {
	test('a damaged store is cleaned, not trusted', () => {
		const dirty = sanitizeAll({ 3: 'Heat', 'bad key!': 'x', 4: 5, 5: '   ', 6: 'a'.repeat(200), 7: null });
		expect(dirty['3']).toBe('Heat');
		expect('bad key!' in dirty).toBe(false);
		expect('4' in dirty).toBe(false);
		expect('5' in dirty).toBe(false);
		expect(dirty['6']?.length).toBe(MAX);
		expect('7' in dirty).toBe(false);
	});
	test('arrays, strings and null read as empty', () => {
		expect(sanitizeAll([1, 2])).toEqual({});
		expect(sanitizeAll('x')).toEqual({});
		expect(sanitizeAll(null)).toEqual({});
	});
});
