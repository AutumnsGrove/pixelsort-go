import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toSpec } from './mask-model';
import type { MaskObject, Stroke } from './regions';

// The table is shared with Go (engine/masks/spec_cases_test.go), which checks that it decodes and rasterises as stated.
const cases = JSON.parse(readFileSync('../engine/testdata/mask-spec-cases.json', 'utf8')) as {
	name: string;
	objects: MaskObject[];
	strokes?: Stroke[];
	invert: boolean;
	feather: number;
	spec: object;
}[];

describe('mask-spec-cases.json (shared with Go)', () => {
	for (const c of cases) it(c.name, () => expect(toSpec(c.objects, c.invert, c.feather, c.strokes)).toEqual(c.spec));
});
