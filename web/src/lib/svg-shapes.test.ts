import { describe, expect, it } from 'vitest';
import { isSvgFile, looksLikeSvg } from './svg-shapes';

// The DOM side (readSvg, starters) needs a real browser and is tested in e2e/svg-shapes.spec.ts. These are the pure parts.
describe('isSvgFile', () => {
	it('goes by type or by extension, and leaves pictures alone', () => {
		expect(isSvgFile({ name: 'a.svg', type: '' })).toBe(true);
		expect(isSvgFile({ name: 'A.SVG', type: 'application/octet-stream' })).toBe(true);
		expect(isSvgFile({ type: 'image/svg+xml' })).toBe(true);
		expect(isSvgFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
		expect(isSvgFile({ name: 'svg.png', type: 'image/png' })).toBe(false);
	});
});

describe('looksLikeSvg', () => {
	it('recognises SVG code, with or without an XML header or comments', () => {
		expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
		expect(looksLikeSvg('  \n<svg>')).toBe(true);
		expect(looksLikeSvg('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg viewBox="0 0 1 1">')).toBe(true);
	});
	it('does not take an address, a sentence or other markup for SVG', () => {
		expect(looksLikeSvg('https://example.com/a.svg')).toBe(false);
		expect(looksLikeSvg('an <svg> in a sentence')).toBe(false);
		expect(looksLikeSvg('<svgfoo>')).toBe(false);
		expect(looksLikeSvg('<html><body><svg></svg></body></html>')).toBe(false);
		expect(looksLikeSvg('')).toBe(false);
	});
});
