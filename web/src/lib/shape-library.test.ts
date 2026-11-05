import { describe, expect, it } from 'vitest';
import type { ApiShape } from './api';
import { nextShapeName, ShapeLibrary, validShape, type ShapeBackend } from './shape-library';
import type { KeyValueStore } from './storage';

const tri: [number, number][] = [
	[0, 0],
	[1, 0],
	[0.5, 1]
];

class Mem implements KeyValueStore {
	data = new Map<string, unknown>();
	get = (k: string) => this.data.get(k) ?? null;
	set = (k: string, v: unknown) => (this.data.set(k, v), true);
	remove = (k: string) => void this.data.delete(k);
}

function fakeServer(up = true) {
	const shapes: ApiShape[] = [];
	let next = 1;
	const down = () => Promise.reject(new Error('offline'));
	const s: ShapeBackend & { up: boolean; shapes: ApiShape[] } = {
		up,
		shapes,
		listShapes: () => (s.up ? Promise.resolve([...shapes].reverse()) : down()),
		addShape: (x: { name: string; poly: [number, number][]; more: [number, number][][] }) => {
			if (!s.up) return down();
			const a: ApiShape = { id: next++, name: x.name, poly: x.poly, more: x.more, created_at: '' };
			shapes.push(a);
			return Promise.resolve(a);
		},
		deleteShape: (id: number) => {
			if (!s.up) return down();
			shapes.splice(
				shapes.findIndex((a) => a.id === id),
				1
			);
			return Promise.resolve();
		}
	};
	return s;
}

describe('ShapeLibrary', () => {
	it('saves to the server when it is there, and lists newest first', async () => {
		const srv = fakeServer();
		const lib = new ShapeLibrary(srv, new Mem());
		await lib.add('one', tri, []);
		await lib.add('two', tri, [tri]);
		const list = await lib.list();
		expect(list.map((s) => s.name)).toEqual(['two', 'one']);
		expect(list.every((s) => !s.local)).toBe(true);
		expect(list[0]!.more).toHaveLength(1);
	});
	it('falls back to this browser when the server is away, then sends the shape up when it is back', async () => {
		const srv = fakeServer(false);
		const mem = new Mem();
		const lib = new ShapeLibrary(srv, mem);
		const mine = await lib.add('offline one', tri, []);
		expect(mine.local).toBe(true);
		expect((await lib.list()).map((s) => s.name)).toEqual(['offline one']);
		srv.up = true;
		const after = await lib.list();
		expect(after).toHaveLength(1);
		expect(after[0]!.local).toBe(false);
		expect(srv.shapes).toHaveLength(1);
		expect(mem.get('pixelsort.shapes')).toEqual([]); // nothing left waiting
	});
	it('keeps a local shape waiting while the server still refuses it', async () => {
		const srv = fakeServer(true);
		srv.addShape = () => Promise.reject(new Error('nope'));
		const lib = new ShapeLibrary(srv, new Mem());
		await lib.add('stuck', tri, []);
		expect((await lib.list()).map((s) => s.name)).toEqual(['stuck']);
	});
	it('removes a local shape from the browser and a server shape from the server', async () => {
		const srv = fakeServer();
		const mem = new Mem();
		const lib = new ShapeLibrary(srv, mem);
		const remote = await lib.add('r', tri, []);
		srv.up = false;
		const local = await lib.add('l', tri, []);
		await lib.remove(local);
		expect(mem.get('pixelsort.shapes')).toEqual([]);
		srv.up = true;
		await lib.remove(remote);
		expect(srv.shapes).toHaveLength(0);
	});
	it('reads a damaged or older local list as empty rather than throwing', async () => {
		const mem = new Mem();
		mem.set('pixelsort.shapes', [{ id: 1 }, 'x', null, { id: 'l1', name: 'ok', poly: tri, more: [] }]);
		const lib = new ShapeLibrary(fakeServer(false), mem);
		expect((await lib.list()).map((s) => s.name)).toEqual(['ok']);
		mem.set('pixelsort.shapes', 'garbage');
		expect(await lib.list()).toEqual([]);
	});
});

describe('validShape / nextShapeName', () => {
	it('needs three finite points in every ring', () => {
		const ok = { id: 'a', name: 'n', poly: tri, more: [] };
		expect(validShape(ok)).toBe(true);
		expect(validShape({ ...ok, poly: tri.slice(0, 2) })).toBe(false);
		expect(
			validShape({
				...ok,
				poly: [
					[0, 0],
					[1, NaN],
					[1, 1]
				]
			})
		).toBe(false);
		expect(validShape({ ...ok, more: [[[0, 0]]] })).toBe(false);
		expect(validShape(null)).toBe(false);
	});
	it('numbers a new shape after the ones you have', () => {
		expect(nextShapeName([])).toBe('Shape 1');
		expect(nextShapeName([{ id: 'a', name: 'x', poly: tri, more: [], local: true }])).toBe('Shape 2');
	});
});
