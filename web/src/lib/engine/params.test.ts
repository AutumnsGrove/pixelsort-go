import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { clampParams, defaultParams, parseParams, validateParams } from './params';

const cases = JSON.parse(readFileSync('../engine/testdata/params-cases.json', 'utf8')) as {
	name: string;
	json: string;
	valid: boolean;
}[];

describe('params-cases.json (shared with Go)', () => {
	test.each(cases)('$name', ({ json, valid }) => {
		expect(parseParams(json).ok).toBe(valid);
	});
});

test('the defaults are valid', () => expect(validateParams({ ...defaultParams })).toBeNull());

test('clampParams drops an interval mode a newer engine does not have', () => {
	expect(clampParams({ mode: 'pattern' }).mode).toBe(defaultParams.mode);
	expect(clampParams({ mode: 'wave' }).mode).toBe('wave');
});
