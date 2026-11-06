import { describe as d, expect, test } from 'vitest';
import { CATALOG, describe, engineErrorCode, type ErrorContext } from './errors';
import { EngineCrashed } from './engine/client';
import { EngineDownloadFailed } from './engine/loader';

const ACTIONS = new Set(['choose', 'close', 'save-and-drop', 'retry', 'reload', 'restart', 'smaller', 'back']);
const ctxs: ErrorContext[] = [
	{},
	{ mp: NaN, max: undefined, band: undefined, bands: null, scale: 0.5, device: 'phone', name: '<b>x</b>' },
	{ reason: 'disk' },
	{ reason: 'quota' },
	{ mb: 212, max: 40 }
];

d('catalog', () => {
	test('has the eleven failures', () => expect(Object.keys(CATALOG).length).toBeGreaterThanOrEqual(11));
	test('every failure has a title, a body, a "what is safe" line, one primary action, no placeholders, no stack-trace words', () => {
		for (const code of Object.keys(CATALOG))
			for (const ctx of ctxs) {
				const v = describe(code, ctx);
				const all = [v.title, v.body, v.safe, ...v.actions.map((a) => a.label)].join(' | ');
				expect(v.title && v.body && v.safe, code).toBeTruthy();
				expect(all, code).not.toMatch(/undefined|NaN|null|\[object/);
				expect(
					v.actions.filter((a) => a.primary),
					code
				).toHaveLength(1);
				expect(
					v.actions.every((a) => ACTIONS.has(a.id) && a.label),
					code
				).toBe(true);
				expect(['error', 'warn']).toContain(v.tone);
				expect(v.title.length, code).toBeLessThanOrEqual(60);
				expect(v.title + v.body + v.safe, code).not.toMatch(/Exception|Error:|stack|\bat \w+\(/);
			}
	});
	test('an unknown code still gets a calm, usable message', () => {
		const u = describe('nope');
		expect(u.code).toBe('unknown');
		expect(u.title).toMatch(/Something went wrong/);
		expect(u.actions).toHaveLength(1);
	});
	test('export-oom names the band and offers the next size down; save-failed says why', () => {
		expect(describe('export-oom', { band: 3, bands: 8 }).body).toMatch(/band 3 of 8/);
		expect(describe('export-oom', { scale: 0.75 }).actions[0]!.label).toMatch(/75%/);
		expect(describe('save-failed', { reason: 'disk' }).body).toMatch(/disk is full/);
		expect(describe('save-failed').safe).toMatch(/Exporting still works/);
	});
	test('engine failures map to a catalog code, never a raw string', () => {
		expect(engineErrorCode(new EngineCrashed('boom'))).toBe('engine-crashed');
		expect(engineErrorCode(new Error('wasm failed'))).toBe('engine-failed');
		expect(engineErrorCode('weird')).toBe('engine-failed');
	});
	test('a failed download is told apart from an engine that broke after it loaded', () => {
		expect(engineErrorCode(new EngineDownloadFailed('/engine.wasm', 2, 'timeout'))).toBe('engine-download-failed');
		const v = describe('engine-download-failed');
		expect(v.title).toMatch(/download/i);
		expect(v.body).toMatch(/connection/i);
		expect(v.safe).toMatch(/picture/i);
		expect(v.actions.map((a) => a.id)).toEqual(['retry', 'reload']);
		expect(v.actions[0]!.primary).toBe(true);
		// the engine-failed text keeps its own meaning: a browser that cannot run it
		expect(describe('engine-failed').body).not.toBe(v.body);
	});
});
