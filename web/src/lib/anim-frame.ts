// Shared animation types and the small pure helpers the encoders and the export loop agree on.
export type FrameImage = { rgba: Uint8ClampedArray; w: number; h: number };

/** Resizes a frame by nearest-neighbour sampling; returns the same object when the size is unchanged. */
export function scaleFrame(frame: FrameImage, w: number, h: number): FrameImage {
	const tw = Math.max(1, Math.round(w));
	const th = Math.max(1, Math.round(h));
	if (frame.w === tw && frame.h === th) return frame;
	const out = new Uint8ClampedArray(tw * th * 4);
	for (let y = 0; y < th; y++) {
		const sy = Math.min(frame.h - 1, Math.floor((y * frame.h) / th));
		for (let x = 0; x < tw; x++) {
			const sx = Math.min(frame.w - 1, Math.floor((x * frame.w) / tw));
			const si = (sy * frame.w + sx) * 4;
			const di = (y * tw + x) * 4;
			out[di] = frame.rgba[si] ?? 0;
			out[di + 1] = frame.rgba[si + 1] ?? 0;
			out[di + 2] = frame.rgba[si + 2] ?? 0;
			out[di + 3] = frame.rgba[si + 3] ?? 255;
		}
	}
	return { rgba: out, w: tw, h: th };
}

/** Up to n indexes from 0..count-1, both ends included and no repeats; the palette sampler's frame picks. */
export function spread(count: number, n: number): number[] {
	if (count <= 0) return [];
	const k = Math.min(n, count);
	if (k === 1) return [0];
	const out: number[] = [];
	let last = -1;
	for (let i = 0; i < k; i++) {
		const idx = Math.round((i * (count - 1)) / (k - 1));
		if (idx !== last) {
			out.push(idx);
			last = idx;
		}
	}
	return out;
}
