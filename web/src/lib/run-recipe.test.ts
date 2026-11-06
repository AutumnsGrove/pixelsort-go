import { describe, expect, test } from 'vitest';
import { defaultParams } from './engine/params';
import { defaultCards, newCard, type RegionCard } from './region-cards';
import { defaultTiling, type MaskObject, type Stroke } from './regions';
import { packRecipe, recipeSlate, unpackRecipe, type LookParts } from './run-recipe';

const ellipse: MaskObject = { kind: 'ellipse', cx: 0.4, cy: 0.5, w: 0.2, h: 0.3, rot: 15, mode: 'add' };
const stroke: Stroke = {
	radius: 0.02,
	points: [
		[0.1, 0.1],
		[0.2, 0.15],
		[0.3, 0.3]
	]
};
const kinds = (): Record<number, RegionCard> => ({ ...defaultCards(), 4: newCard('Kind 4'), 5: newCard('Kind 5') });
const look = (over: Partial<LookParts> = {}): LookParts => ({
	params: { ...defaultParams, angle: 33, mode: 'wave' },
	tiling: null,
	cards: kinds(),
	mask: null,
	...over
});

describe('what a saved run holds', () => {
	test('a plain sort stores exactly the params it always did, so old runs and their duplicates still match', () => {
		const s = packRecipe(look());
		expect(s).toEqual({ ...defaultParams, angle: 33, mode: 'wave' });
		expect('regions' in s || 'mask' in s).toBe(false);
	});

	test('cells and protected areas are stored next to the params, not mixed into them', () => {
		const s = packRecipe(
			look({
				tiling: { ...defaultTiling('hexagon', 7), pattern: 'thirds' },
				mask: { objects: [ellipse], strokes: [stroke], invert: true, feather: 6 }
			})
		);
		expect(s.angle).toBe(33);
		expect(s.regions).toMatchObject({ tiling: { shape: 'hexagon', pattern: 'thirds' } });
		expect(s.mask).toEqual({ objects: [ellipse], strokes: [stroke], invert: true, feather: 6 });
		// the cards only matter while there are cells
		expect(Object.keys((s.regions as { cards: object }).cards).length).toBeGreaterThan(0);
	});

	test('a mask that is switched off is not stored, and cards are not stored without cells', () => {
		const s = packRecipe(look({ mask: { objects: [], strokes: [], invert: false, feather: 0 } }));
		expect('mask' in s).toBe(false);
		expect('regions' in s).toBe(false);
	});

	test('the whole look survives a round trip, including a custom shape with a hole', () => {
		const tiling = {
			...defaultTiling('custom', 9),
			poly: [
				[0.1, 0.1],
				[0.9, 0.1],
				[0.9, 0.9],
				[0.1, 0.9]
			] as [number, number][],
			more: [
				[
					[0.4, 0.4],
					[0.6, 0.4],
					[0.6, 0.6]
				]
			] as [number, number][][],
			stagger: true
		};
		const cards = kinds();
		cards[1] = newCard('Kind A', { angleOn: true, angle: 120, key: 'hue', frozen: true });
		const back = unpackRecipe(
			JSON.parse(
				JSON.stringify(
					packRecipe(
						look({ tiling, cards, mask: { objects: [ellipse], strokes: [stroke], invert: false, feather: 3 } })
					)
				)
			)
		);
		expect(back.params).toMatchObject({ angle: 33, mode: 'wave', seed: 7 });
		expect(back.tiling).toEqual(tiling);
		expect(back.cards?.[1]).toMatchObject({ angleOn: true, angle: 120, key: 'hue', frozen: true });
		expect(back.mask).toEqual({ objects: [ellipse], strokes: [stroke], invert: false, feather: 3 });
	});
});

describe('opening a run is forgiving', () => {
	test('an old run (params only) opens with no cells and no mask', () => {
		const back = unpackRecipe({ mode: 'edges', angle: 12, seed: 4 });
		expect(back.params).toMatchObject({ mode: 'edges', angle: 12, seed: 4, length: defaultParams.length });
		expect(back.tiling).toBeNull();
		expect(back.cards).toBeNull();
		expect(back.mask).toBeNull();
	});

	test('junk is dropped, never trusted: unknown keys, wrong types, out-of-range numbers', () => {
		const back = unpackRecipe({
			mode: 'nonsense',
			angle: 'ninety',
			length: 99999,
			evil: { x: 1 },
			__proto__: { polluted: true },
			key: 'hue'
		});
		expect(back.params.mode).toBe(defaultParams.mode);
		expect(back.params.angle).toBe(defaultParams.angle);
		expect(back.params.length).toBe(1000);
		expect(back.params.key).toBe('hue');
		expect('evil' in back.params).toBe(false);
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	test('a damaged tiling or mask is ignored rather than breaking the open', () => {
		expect(unpackRecipe({ regions: { tiling: { shape: 'blob' } } }).tiling).toBeNull();
		expect(unpackRecipe({ regions: { tiling: { shape: 'hexagon', size: 'big' } } }).tiling).toBeNull();
		expect(unpackRecipe({ regions: 5, mask: 'x' })).toMatchObject({ tiling: null, mask: null });
		const m = unpackRecipe({
			mask: { objects: [{ kind: 'star' }, ellipse], strokes: [{ points: 'no' }, stroke], invert: 'yes', feather: 999 }
		}).mask!;
		expect(m.objects).toEqual([ellipse]); // the bad one is dropped, the good one kept
		expect(m.strokes).toEqual([stroke]);
		expect(m.invert).toBe(false);
		expect(m.feather).toBe(24);
	});

	test('size limits: absurdly many points or strokes are cut off', () => {
		const huge = { radius: 0.01, points: Array.from({ length: 50_000 }, (_, i) => [i / 50_000, 0.5]) };
		const m = unpackRecipe({ mask: { objects: [], strokes: Array.from({ length: 2000 }, () => huge) } }).mask!;
		expect(m.strokes.length).toBeLessThanOrEqual(500);
		expect(m.strokes[0]!.points.length).toBeLessThanOrEqual(5000);
	});

	test('cards are cleaned like any typed card: numbers clamped, names kept short', () => {
		const back = unpackRecipe({
			regions: {
				tiling: defaultTiling('square', 1),
				cards: { 1: { ...newCard('x'.repeat(200)), length: 99999, angle: -45 }, 99: newCard('far'), foo: 1 }
			}
		});
		expect(back.cards?.[1]?.length).toBe(1000);
		expect(back.cards?.[1]?.angle).toBe(315);
		expect(back.cards?.[1]?.name.length).toBeLessThanOrEqual(40);
		expect(back.cards?.[99]).toBeUndefined();
	});
});

describe('the recipe slate shown in the viewer', () => {
	test('names the sort in plain words', () => {
		const rows = recipeSlate({ ...defaultParams, mode: 'wave', angle: 45, key: 'hue', length: 60 });
		const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n');
		expect(text).toContain('Intervals: wave');
		expect(text).toContain('Sort by: hue');
		expect(text).toContain('Direction: 45°');
		expect(text).toContain('Length: 60');
	});

	test('cellular modes name the rule and its space; threshold names the band', () => {
		expect(
			recipeSlate({ ...defaultParams, mode: 'ca', rule: 30, caSpace: 'line' })
				.map((r) => r.value)
				.join(' ')
		).toMatch(/30.*line|line.*30/);
		expect(
			recipeSlate({ ...defaultParams, mode: 'threshold', lo: 20, hi: 200 }).some(
				(r) => r.value.includes('20') && r.value.includes('200')
			)
		).toBe(true);
	});

	test('says what shapes and protected areas the look has, and nothing when it has none', () => {
		const plain = recipeSlate({ ...defaultParams });
		expect(plain.some((r) => r.label === 'Shapes' || r.label === 'Protected')).toBe(false);
		const rich = recipeSlate({
			...packRecipe(
				look({
					tiling: defaultTiling('hexagon', 1),
					mask: { objects: [ellipse, ellipse], strokes: [stroke], invert: true, feather: 0 }
				})
			)
		});
		expect(rich.find((r) => r.label === 'Shapes')?.value).toMatch(/hexagon/);
		expect(rich.find((r) => r.label === 'Protected')?.value).toMatch(/2 shapes.*1 brush stroke.*inverted/);
	});

	test('never throws on a strange settings object', () => {
		for (const s of [{}, { mode: 5 }, { regions: null, mask: [] }])
			expect(() => recipeSlate(s as Record<string, unknown>)).not.toThrow();
	});
});
