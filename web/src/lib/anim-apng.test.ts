import { describe, expect, it } from 'vitest';
import { APNGEncoder, chunk, crc32 } from '#lib/anim-apng';

type Chunk = { type: string; data: Uint8Array };

async function parseBlob(blob: Blob): Promise<Chunk[]> {
	const b = new Uint8Array(await blob.arrayBuffer());
	expect(Array.from(b.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const out: Chunk[] = [];
	for (let p = 8; p < b.length;) {
		const view = new DataView(b.buffer, b.byteOffset + p, 8);
		const n = view.getUint32(0, false);
		const type = String.fromCharCode(...b.slice(p + 4, p + 8));
		const data = b.slice(p + 8, p + 8 + n);
		const want = new DataView(b.buffer, b.byteOffset + p + 8 + n, 4).getUint32(0, false);
		expect(crc32(b.slice(p + 4, p + 8 + n))).toBe(want);
		out.push({ type, data });
		p += 12 + n;
	}
	return out;
}

function u32(b: Uint8Array, at = 0): number {
	return new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, false);
}
function u16(b: Uint8Array, at = 0): number {
	return new DataView(b.buffer, b.byteOffset + at, 2).getUint16(0, false);
}

async function inflate(b: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('deflate');
	const w = ds.writable.getWriter();
	void w.write(b as unknown as BufferSource);
	void w.close();
	return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function frame(r: number, g: number, b: number) {
	const rgba = new Uint8ClampedArray(2 * 2 * 4);
	for (let i = 0; i < 4; i++) rgba.set([r, g, b, 255], i * 4);
	return { rgba, w: 2, h: 2 };
}

describe('APNGEncoder', () => {
	it('writes the chunks and sequence numbers APNG needs', async () => {
		const e = new APNGEncoder(2, 2, 2, true);
		await e.addFrame(frame(255, 0, 0), 100);
		await e.addFrame(frame(0, 0, 255), 350);
		const chunks = await parseBlob(e.finish());
		expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
		expect(u32(chunks[1]!.data, 0)).toBe(2); // frames
		expect(u32(chunks[1]!.data, 4)).toBe(0); // plays forever
		expect(u32(chunks[2]!.data, 0)).toBe(0); // first fcTL
		expect(u32(chunks[4]!.data, 0)).toBe(1); // second fcTL
		expect(u32(chunks[5]!.data, 0)).toBe(2); // fdAT
		expect(u16(chunks[2]!.data, 20)).toBe(100);
		expect(u16(chunks[2]!.data, 22)).toBe(1000);
		expect(u16(chunks[4]!.data, 20)).toBe(350);
	});

	it('keeps the last frame lossless', async () => {
		const e = new APNGEncoder(2, 2, 2, false);
		await e.addFrame(frame(255, 0, 0), 100);
		await e.addFrame(frame(10, 20, 30), 100);
		const chunks = await parseBlob(e.finish());
		expect(u32(chunks[1]!.data, 4)).toBe(1); // plays once
		const raw = await inflate(chunks[5]!.data.slice(4));
		// Two scanlines, each a filter byte and 8 bytes of RGBA.
		expect(raw.length).toBe(2 * 9);
		expect(raw[0]).toBe(0);
		expect(Array.from(raw.slice(1, 5))).toEqual([10, 20, 30, 255]);
		expect(Array.from(raw.slice(10, 14))).toEqual([10, 20, 30, 255]);
	});

	it('refuses the wrong size and too many frames', async () => {
		const e = new APNGEncoder(2, 2, 1, false);
		await expect(e.addFrame({ rgba: new Uint8ClampedArray(4), w: 1, h: 1 }, 100)).rejects.toThrow('not 2x2');
		await e.addFrame(frame(1, 2, 3), 100);
		await expect(e.addFrame(frame(1, 2, 3), 100)).rejects.toThrow('more than');
	});

	it('chunk() writes the CRC over type and data', () => {
		const c = chunk('tEXt', new Uint8Array([1, 2, 3]));
		expect(u32(c, 0)).toBe(3);
		expect(String.fromCharCode(...c.slice(4, 8))).toBe('tEXt');
	});
});
