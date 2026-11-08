import { describe, expect, it } from 'vitest';
import { GIFEncoderStream } from '#lib/anim-gif';

type Frame = { rgba: Uint8ClampedArray; w: number; h: number };

function solid(r: number, g: number, b: number): Frame {
	const rgba = new Uint8ClampedArray(2 * 2 * 4);
	for (let i = 0; i < 4; i++) rgba.set([r, g, b, 255], i * 4);
	return { rgba, w: 2, h: 2 };
}

type Decoded = {
	width: number;
	height: number;
	palette: number[][];
	frames: { indices: number[]; delay: number }[];
	loop: number;
};

/** A small GIF reader, enough for the files this encoder writes (global palette, no transparency). */
function decodeGIF(bytes: Uint8Array): Decoded {
	let p = 0;
	const str = (n: number) => String.fromCharCode(...bytes.slice(p, (p += n)));
	expect(str(6)).toBe('GIF89a');
	const width = bytes[p]! | (bytes[p + 1]! << 8);
	const height = bytes[p + 2]! | (bytes[p + 3]! << 8);
	const packed = bytes[p + 4]!;
	p += 7;
	const palette: number[][] = [];
	if (packed & 0x80) {
		const n = 1 << ((packed & 7) + 1);
		for (let i = 0; i < n; i++) {
			palette.push([bytes[p]!, bytes[p + 1]!, bytes[p + 2]!]);
			p += 3;
		}
	}
	const frames: { indices: number[]; delay: number }[] = [];
	let loop = -1;
	let delay = 0;
	while (p < bytes.length) {
		const b = bytes[p]!;
		if (b === 0x3b) break;
		if (b === 0x21) {
			const label = bytes[p + 1]!;
			p += 2;
			if (label === 0xf9) {
				const n = bytes[p]!;
				delay = bytes[p + 2]! | (bytes[p + 3]! << 8);
				p += n + 1;
			}
			if (label === 0xff) {
				const n = bytes[p]!;
				const id = String.fromCharCode(...bytes.slice(p + 1, p + 1 + n));
				p += n + 1;
				if (id.startsWith('NETSCAPE')) {
					const sub = bytes[p]!;
					loop = bytes[p + 2]! | (bytes[p + 3]! << 8);
					p += sub + 1;
				}
			}
			while (bytes[p] !== 0) p += bytes[p]! + 1;
			p++;
			continue;
		}
		expect(b).toBe(0x2c);
		p += 10; // descriptor, no local table in these files
		const minCode = bytes[p]!;
		p++;
		const data: number[] = [];
		while (bytes[p] !== 0) {
			const n = bytes[p]!;
			data.push(...bytes.slice(p + 1, p + 1 + n));
			p += n + 1;
		}
		p++;
		frames.push({ indices: lzwDecode(Uint8Array.from(data), minCode), delay });
	}
	return { width, height, palette, frames, loop };
}

/** LSB-first variable-width LZW, the GIF dialect. */
function lzwDecode(data: Uint8Array, minCode: number): number[] {
	const clear = 1 << minCode;
	const eoi = clear + 1;
	let dict: number[][] = [];
	let codeSize = minCode + 1;
	let next = eoi + 1;
	const reset = () => {
		dict = [];
		for (let i = 0; i < clear; i++) dict[i] = [i];
		next = eoi + 1;
		codeSize = minCode + 1;
	};
	reset();
	let bit = 0;
	let prev: number[] | null = null;
	const out: number[] = [];
	const read = () => {
		let v = 0;
		for (let i = 0; i < codeSize; i++) {
			const byte = data[bit >> 3] ?? 0;
			v |= ((byte >> (bit & 7)) & 1) << i;
			bit++;
		}
		return v;
	};
	while (bit + codeSize <= data.length * 8) {
		const code = read();
		if (code === clear) {
			reset();
			prev = null;
			continue;
		}
		if (code === eoi) break;
		let entry: number[];
		if (code < next && dict[code]) entry = dict[code]!;
		else if (prev) entry = [...prev, prev[0]!];
		else break;
		out.push(...entry);
		if (prev) {
			dict[next++] = [...prev, entry[0]!];
			if (next === 1 << codeSize && codeSize < 12) codeSize++;
		}
		prev = entry;
	}
	return out;
}

describe('GIFEncoderStream', () => {
	it('builds one palette, loops forever and paces the frames', async () => {
		const red = solid(255, 0, 0);
		const blue = solid(0, 0, 255);
		const source = async (pass: number) => (pass === 0 ? red : blue);
		const gif = new GIFEncoderStream(2, 2, true);
		await gif.prepare(source, [0, 5]);
		gif.addFrame(red, 100);
		gif.addFrame(blue, 350);
		const blob = gif.finish();
		const d = decodeGIF(new Uint8Array(await blob.arrayBuffer()));
		expect(blob.type).toBe('image/gif');
		expect(d.width).toBe(2);
		expect(d.height).toBe(2);
		expect(d.loop).toBe(0);
		expect(d.frames).toHaveLength(2);
		expect(d.frames[0]!.delay).toBe(10);
		expect(d.frames[1]!.delay).toBe(35);
		const first = d.palette[d.frames[0]!.indices[0]!];
		const second = d.palette[d.frames[1]!.indices[0]!];
		expect(first).toEqual([255, 0, 0]);
		expect(second).toEqual([0, 0, 255]);
	});

	it('refuses frames before the palette exists', () => {
		const gif = new GIFEncoderStream(2, 2, true);
		expect(() => gif.addFrame(solid(0, 0, 0), 100)).toThrow('not prepared');
	});
});
