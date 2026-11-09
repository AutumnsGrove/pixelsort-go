// Animated GIF encoder. gifenc (MIT, lazily loaded by the export panel) provides the quantizer-free container and LZW;
// this module owns the one global palette, the ordered dither and the frame pacing so they match the CLI's approach.
import { GIFEncoder, applyPalette, quantize, type Palette } from 'gifenc';
import type { FrameImage } from './anim-frame';
import { spread } from './anim-frame';

/** How many pixels one sampled frame contributes to the palette. */
const SAMPLES_PER_FRAME = 25_000;

// An 8x8 ordered dither, scaled to a quarter of a palette step. It breaks up banding without moving flat colours far.
const BAYER8 = [
	0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54,
	22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29,
	53, 21
];
const DITHER_STRENGTH = 12;

/** A source that answers with the frame at one pass, already scaled by the caller. */
export type FrameSource = (pass: number) => Promise<FrameImage>;

/** Builds one global palette from up to eight frames spread over the sequence, then encodes with it. */
export class GIFEncoderStream {
	private readonly gif = GIFEncoder();
	private palette: Palette | null = null;
	private first = true;

	constructor(
		private readonly width: number,
		private readonly height: number,
		private readonly loop: boolean
	) {}

	/** Samples the palette. The export loop calls this before the first frame; afterwards the source restarts at pass 0. */
	async prepare(source: FrameSource, passes: number[]): Promise<void> {
		const picks = spread(passes.length, 8);
		const chunks: Uint8ClampedArray[] = [];
		let total = 0;
		for (const p of picks) {
			const frame = await source(passes[p] ?? 0);
			const sample = sampleFrame(frame);
			chunks.push(sample);
			total += sample.length;
		}
		const all = new Uint8ClampedArray(total);
		let at = 0;
		for (const c of chunks) {
			all.set(c, at);
			at += c.length;
		}
		const pal = quantize(all, 256, { format: 'rgb565' });
		this.palette =
			pal.length > 0
				? pal
				: [
						[0, 0, 0],
						[255, 255, 255]
					];
	}

	/** Adds one frame with its delay in milliseconds. */
	addFrame(frame: FrameImage, delayMs: number): void {
		if (!this.palette) throw new Error('GIF palette was not prepared');
		if (frame.w !== this.width || frame.h !== this.height)
			throw new Error(`GIF frame is not ${this.width}x${this.height}`);
		const indices = applyPalette(dither(frame), this.palette, 'rgb565');
		this.gif.writeFrame(indices, this.width, this.height, {
			// Only the first frame carries the palette; later frames share the global table.
			palette: this.first ? this.palette : undefined,
			delay: delayMs,
			repeat: this.loop ? 0 : -1
		});
		this.first = false;
	}

	/** Writes the trailer and returns the file. */
	finish(): Blob {
		this.gif.finish();
		return new Blob([this.gif.bytes() as BlobPart], { type: 'image/gif' });
	}
}

/** Up to SAMPLES_PER_FRAME pixels from a frame, evenly spaced, as RGBA. */
function sampleFrame(frame: FrameImage): Uint8ClampedArray {
	const pixels = frame.w * frame.h;
	const stride = Math.max(1, Math.floor(pixels / SAMPLES_PER_FRAME));
	const out = new Uint8ClampedArray(Math.ceil(pixels / stride) * 4);
	let at = 0;
	for (let i = 0; i < pixels; i += stride) {
		const s = i * 4;
		out[at++] = frame.rgba[s] ?? 0;
		out[at++] = frame.rgba[s + 1] ?? 0;
		out[at++] = frame.rgba[s + 2] ?? 0;
		out[at++] = frame.rgba[s + 3] ?? 255;
	}
	return out;
}

/** Applies the ordered dither to a copy of the frame, leaving alpha alone. */
function dither(frame: FrameImage): Uint8ClampedArray {
	const out = new Uint8ClampedArray(frame.rgba);
	const w = frame.w;
	for (let y = 0; y < frame.h; y++) {
		for (let x = 0; x < w; x++) {
			const b = (BAYER8[((y & 7) << 3) + (x & 7)] ?? 32) / 64 - 0.5;
			const d = b * DITHER_STRENGTH;
			const i = (y * w + x) * 4;
			out[i] = Math.max(0, Math.min(255, (out[i] ?? 0) + d));
			out[i + 1] = Math.max(0, Math.min(255, (out[i + 1] ?? 0) + d));
			out[i + 2] = Math.max(0, Math.min(255, (out[i + 2] ?? 0) + d));
		}
	}
	return out;
}
