import { describe, expect, it } from 'vitest';
import { clientFrameSource, createEncoder, exportAnimation, animMime, type AnimEncoder } from '#lib/export-anim';
import { newSequence } from '#lib/anim-sampler';
import { scaleFrame, spread } from '#lib/anim-frame';

function fakeFrame(pass: number) {
	const rgba = new Uint8ClampedArray([pass, pass, pass, 255]);
	return { rgba, w: 1, h: 1 };
}

class Recorder implements AnimEncoder {
	frames: { pass: number; delay: number }[] = [];
	prepared: number[] | null = null;
	finished = false;
	async prepare(_source: (p: number) => Promise<ReturnType<typeof fakeFrame>>, passes: number[]) {
		this.prepared = passes;
	}
	addFrame(frame: { rgba: Uint8ClampedArray }, delay: number) {
		this.frames.push({ pass: frame.rgba[0] ?? 0, delay });
	}
	finish() {
		this.finished = true;
		return new Blob([new Uint8Array([1])], { type: 'application/x-test' });
	}
}

describe('exportAnimation', () => {
	it('walks the sampler in order with the sampler delays', async () => {
		const seq = newSequence(6, 400, 5, 100, 'linear'); // 2 frames: passes 0 and 6
		const rec = new Recorder();
		const seen: number[] = [];
		const blob = await exportAnimation({
			sequence: seq,
			source: async (p) => {
				seen.push(p);
				return fakeFrame(p);
			},
			encoder: rec
		});
		expect(seen).toEqual(seq.passes);
		expect(rec.frames.map((f) => f.pass)).toEqual(seq.passes);
		expect(rec.frames.map((f) => f.delay)).toEqual(seq.delaysMs);
		expect(rec.finished).toBe(true);
		expect(blob.type).toBe('application/x-test');
	});

	it('reports progress once a frame', async () => {
		const seq = newSequence(20, 1000, 5, 0, 'linear');
		const progress: number[] = [];
		await exportAnimation({
			sequence: seq,
			source: async (p) => fakeFrame(p),
			encoder: new Recorder(),
			onProgress: (p) => progress.push(p.done)
		});
		expect(progress).toEqual(seq.passes.map((_, i) => i + 1));
	});

	it('gives the encoder the palette picks', async () => {
		const seq = newSequence(100, 1000, 5, 0, 'linear');
		const rec = new Recorder();
		await exportAnimation({ sequence: seq, source: async (p) => fakeFrame(p), encoder: rec });
		expect(rec.prepared).toEqual(spread(seq.passes.length, 8));
	});

	it('stops before the first frame when already cancelled', async () => {
		const seq = newSequence(10, 1000, 5, 0, 'linear');
		const rec = new Recorder();
		const ac = new AbortController();
		ac.abort();
		await expect(
			exportAnimation({ sequence: seq, source: async (p) => fakeFrame(p), encoder: rec, signal: ac.signal })
		).rejects.toThrow('cancelled');
		expect(rec.frames).toHaveLength(0);
	});

	it('stops at the next frame when cancelled mid-way', async () => {
		const seq = newSequence(100, 1000, 10, 0, 'linear');
		const rec = new Recorder();
		const ac = new AbortController();
		await expect(
			exportAnimation({
				sequence: seq,
				source: async (p) => {
					if (p > 0) ac.abort();
					return fakeFrame(p);
				},
				encoder: rec,
				signal: ac.signal
			})
		).rejects.toThrow('cancelled');
		expect(rec.frames.length).toBe(2); // the frame fetched as the abort landed still counts
		expect(rec.finished).toBe(false);
	});
});

describe('createEncoder', () => {
	it('loads a GIF encoder lazily', async () => {
		const e = await createEncoder('gif', 1, 1, 1, true);
		expect(e).toBeDefined();
		expect(animMime('gif')).toBe('image/gif');
	});
	it('loads an APNG encoder lazily', async () => {
		const e = await createEncoder('apng', 1, 1, 1, false);
		expect(e).toBeDefined();
		expect(animMime('apng')).toBe('image/apng');
	});

	it('refuses video with a clear error when WebCodecs cannot encode it', async () => {
		await expect(createEncoder('mp4', 640, 360, 10, false)).rejects.toThrow('cannot encode mp4');
		expect(animMime('mp4')).toBe('video/mp4');
		expect(animMime('webm')).toBe('video/webm');
	});
});

describe('clientFrameSource', () => {
	it('seeks each pass and scales the pixels it gets back', async () => {
		const seen: number[] = [];
		const source = clientFrameSource(
			{
				seek: async (pass: number) => {
					seen.push(pass);
					return { rgba: new Uint8ClampedArray([pass, pass, pass, 255]) };
				}
			},
			1,
			1,
			1,
			1
		);
		const frame = await source(9);
		expect(seen).toEqual([9]);
		expect(frame.rgba[0]).toBe(9);
	});

	it('refuses a superseded seek', async () => {
		const source = clientFrameSource({ seek: async () => 'superseded' as const }, 1, 1, 1, 1);
		await expect(source(0)).rejects.toThrow('superseded');
	});
});

describe('frame helpers', () => {
	it('spread includes both ends and never repeats', () => {
		expect(spread(10, 8)).toEqual([0, 1, 3, 4, 5, 6, 8, 9]);
		expect(spread(1, 8)).toEqual([0]);
		expect(spread(0, 8)).toEqual([]);
	});

	it('scaleFrame copies the corners and keeps the size when unchanged', () => {
		const src = {
			rgba: new Uint8ClampedArray([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]),
			w: 2,
			h: 2
		};
		expect(scaleFrame(src, 2, 2)).toBe(src);
		const out = scaleFrame(src, 4, 4);
		expect([out.rgba[0], out.rgba[12], out.rgba[48], out.rgba[60]]).toEqual([10, 20, 30, 40]);
	});
});
