import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	cardSummary,
	cardsToClassDefs,
	cardToClassDef,
	defaultCards,
	kindCounts,
	newCard,
	type RegionCard
} from './region-cards';

const cases = JSON.parse(readFileSync('../engine/testdata/region-card-cases.json', 'utf8')) as {
	name: string;
	card: Partial<RegionCard>;
	classDef: object;
}[];

describe('region-card-cases.json (shared with Go)', () => {
	for (const c of cases) it(c.name, () => expect(cardToClassDef(newCard('t', c.card))).toEqual(c.classDef));
});

describe('cardSummary', () => {
	it('reads right for the four starting cards', () => {
		const d = defaultCards();
		expect(cardSummary(d[0]!)).toBe('frozen — never moves');
		expect(cardSummary(d[1]!)).toBe('inherits everything');
		expect(cardSummary(d[2]!)).toBe('90°');
		expect(cardSummary(d[3]!)).toBe('45° · hue');
	});
	it('lists direction, key and order, animation and cutting in that order', () => {
		const c = newCard('t', {
			angleOn: true,
			angle: 12,
			key: 'hue',
			order: 'desc',
			algo: 'insertion',
			cutOn: true,
			mode: 'ca',
			rule: 154
		});
		expect(cardSummary(c)).toBe('12° · hue ↓ · insertion · cellular 154');
	});
	it('says "global key" when only the order is set', () => {
		expect(cardSummary(newCard('t', { order: 'asc' }))).toBe('global key ↑');
	});
	it('shows the detail of each cutting mode', () => {
		const cut = (mode: RegionCard['mode']) => cardSummary(newCard('t', { cutOn: true, mode }));
		expect(cut('random')).toBe('random 83');
		expect(cut('threshold')).toBe('threshold 51–209');
		expect(cut('edges')).toBe('edges 26');
		expect(cut('none')).toBe('none');
	});
});

describe('kindCounts', () => {
	it('counts shapes per kind and skips the gaps (cell 0)', () => {
		expect(kindCounts(new Uint8Array([0, 1, 2, 1, 1, 2]))).toEqual({ 1: 3, 2: 2 });
		expect(kindCounts(null)).toEqual({});
		expect(kindCounts(new Uint8Array([0]))).toEqual({});
	});
});

describe('cardsToClassDefs', () => {
	it('puts the always-frozen gaps first and one definition per kind', () => {
		const defs = cardsToClassDefs(defaultCards(), 3);
		expect(defs).toHaveLength(4);
		expect(defs[0]).toEqual({ frozen: true });
		expect(defs[1]).toEqual({});
		expect(defs[2]).toEqual({ angle: 90 });
		expect(defs[3]).toEqual({ angle: 45, key: 'hue' });
	});
	it('makes a plain card for a kind that has none yet', () => {
		expect(cardsToClassDefs({}, 2)).toEqual([{ frozen: true }, {}, {}]);
	});
	it('ignores a "frozen" gaps card: class 0 is always frozen', () => {
		expect(cardsToClassDefs({ 0: newCard('g', { frozen: false }) }, 0)).toEqual([{ frozen: true }]);
	});
});
