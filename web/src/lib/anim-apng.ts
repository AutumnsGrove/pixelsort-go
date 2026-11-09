// Animated PNG writer: each frame is RGBA, filtered and deflated, then framed as an APNG (acTL/fcTL/IDAT/fdAT). No
// third-party code; CompressionStream('deflate') is the zlib stream PNG's IDAT wants.
import type { FrameImage } from './anim-frame';

export type { FrameImage };

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

/** CRC-32 of a PNG chunk type and data. */
export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = (crcTable[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function u32(v: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, v, false);
	return b;
}

function u16(v: number): Uint8Array {
	const b = new Uint8Array(2);
	new DataView(b.buffer).setUint16(0, v, false);
	return b;
}

/** One PNG chunk: length, type, data, CRC over type+data. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
	const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
	const out = new Uint8Array(12 + data.length);
	out.set(u32(data.length), 0);
	out.set(t, 4);
	out.set(data, 8);
	out.set(u32(crc32(concat([t, data]))), 8 + data.length);
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const n = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(n);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream('deflate');
	const writer = cs.writable.getWriter();
	// The stream copies; safe to hand it the frame buffer.
	void writer.write(bytes as unknown as BufferSource); // TS' typed-array generics are narrower than CompressionStream's
	void writer.close();
	return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Streams an APNG with the frame count declared up front, as the acTL chunk requires. */
export class APNGEncoder {
	private readonly parts: Uint8Array[] = [];
	private readonly ihdr: Uint8Array;
	private seq = 0;
	private written = 0;
	private closed = false;

	constructor(
		private readonly width: number,
		private readonly height: number,
		private readonly frames: number,
		private readonly loop: boolean
	) {
		const h = new Uint8Array(13);
		h.set(u32(width), 0);
		h.set(u32(height), 4);
		h[8] = 8; // bit depth
		h[9] = 6; // RGBA
		this.ihdr = chunk('IHDR', h);
		const actl = new Uint8Array(8);
		actl.set(u32(frames), 0);
		actl.set(u32(loop ? 0 : 1), 4);
		this.parts.push(SIGNATURE, this.ihdr, chunk('acTL', actl));
	}

	/** Compresses and appends one frame. */
	async addFrame(frame: FrameImage, delayMs: number): Promise<void> {
		if (this.closed) throw new Error('APNG already closed');
		if (frame.w !== this.width || frame.h !== this.height || frame.rgba.length !== frame.w * frame.h * 4)
			throw new Error(`APNG frame is not ${this.width}x${this.height}`);
		if (this.written >= this.frames) throw new Error(`APNG has more than the declared ${this.frames} frames`);
		const first = this.written === 0;
		const idat = await deflate(filtered(frame));
		this.parts.push(chunk('fcTL', this.fctl(Math.max(1, Math.min(0xffff, Math.round(delayMs))))));
		this.seq++;
		if (first) {
			this.parts.push(chunk('IDAT', idat));
		} else {
			this.parts.push(chunk('fdAT', concat([u32(this.seq), idat])));
			this.seq++;
		}
		this.written++;
	}

	/** Writes IEND and returns the file. */
	finish(): Blob {
		if (!this.closed) {
			this.closed = true;
			this.parts.push(chunk('IEND', new Uint8Array(0)));
		}
		return new Blob([concat(this.parts) as BlobPart], { type: 'image/apng' });
	}

	private fctl(delayMs: number): Uint8Array {
		const d = new Uint8Array(26);
		d.set(u32(this.seq), 0);
		d.set(u32(this.width), 4);
		d.set(u32(this.height), 8);
		d.set(u16(delayMs), 20);
		d.set(u16(1000), 22);
		return d;
	}
}

/** Prefixes every scanline with filter type 0, the layout PNG compresses. */
function filtered(frame: FrameImage): Uint8Array {
	const stride = frame.w * 4;
	const out = new Uint8Array((stride + 1) * frame.h);
	for (let y = 0; y < frame.h; y++) {
		out[y * (stride + 1)] = 0;
		out.set(frame.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	return out;
}
