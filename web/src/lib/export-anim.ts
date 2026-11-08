// The animation export loop: walk the sampler's passes, ask the engine for each frame, hand it to an encoder, and
// report progress. It is pure orchestration, so the preview and the write path can share it and the tests need no
// browser.
import type { Sequence } from './anim-sampler';
import type { FrameImage } from './anim-frame';
import { scaleFrame, spread } from './anim-frame';

export type AnimFormat = 'gif' | 'apng' | 'mp4' | 'webm';

/** Answers with the frame at one pass, already scaled to the export size. */
export type FrameSource = (pass: number) => Promise<FrameImage>;

export type AnimEncoder = {
	/** Receives the picks it may sample for a palette before the first frame (GIF only). */
	prepare?(source: FrameSource, passes: number[]): Promise<void>;
	addFrame(frame: FrameImage, delayMs: number): void | Promise<void>;
	finish(): Blob | Promise<Blob>;
};

export type ExportProgress = { done: number; total: number };

function aborted(): Error {
	const e = new Error('Animation export cancelled');
	e.name = 'AbortError';
	return e;
}

/**
 * Runs one export. The source is called in pass order; the encoder sees the same frames the preview shows. Cancelling
 * stops at the next frame boundary and throws an AbortError.
 */
export async function exportAnimation(opts: {
	sequence: Sequence;
	source: FrameSource;
	encoder: AnimEncoder;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
}): Promise<Blob> {
	const { sequence, source, encoder, signal } = opts;
	const total = sequence.passes.length;
	if (signal?.aborted) throw aborted();
	await encoder.prepare?.(source, spread(total, 8));
	for (let i = 0; i < total; i++) {
		if (signal?.aborted) throw aborted();
		const frame = await source(sequence.passes[i] ?? 0);
		await encoder.addFrame(frame, sequence.delaysMs[i] ?? 0);
		opts.onProgress?.({ done: i + 1, total });
	}
	return encoder.finish();
}

/** The encoder for a format, loaded on demand so its library costs nothing until an export starts. */
export async function createEncoder(
	format: AnimFormat,
	width: number,
	height: number,
	frames: number,
	loop: boolean,
	fps = 30
): Promise<AnimEncoder> {
	if (format === 'gif') {
		const { GIFEncoderStream } = await import('./anim-gif');
		return new GIFEncoderStream(width, height, loop);
	}
	if (format === 'apng') {
		const { APNGEncoder } = await import('./anim-apng');
		return new APNGEncoder(width, height, frames, loop);
	}
	const { VideoEncoderStream, pickVideoCodec } = await import('./anim-video');
	const codec = await pickVideoCodec(format, width, height, fps);
	if (!codec) throw new Error(`This browser cannot encode ${format} video here.`);
	return new VideoEncoderStream(format, codec, width, height, fps);
}

/** The part of EngineClient the export needs, so tests can stand in for it. */
export type SeekClient = {
	seek(pass: number): Promise<{ rgba: Uint8ClampedArray } | 'superseded'>;
};

/**
 * A frame source over a second engine session: seek to the pass (the engine returns those pixels), then scale them to
 * the export size. The seek is awaited one frame at a time, so the client's "latest wins" coalescing never kicks in.
 */
export function clientFrameSource(
	client: SeekClient,
	clientW: number,
	clientH: number,
	outW: number,
	outH: number
): FrameSource {
	return async (pass) => {
		const r = await client.seek(pass);
		if (r === 'superseded') throw new Error('animation frame was superseded');
		return scaleFrame({ rgba: r.rgba, w: clientW, h: clientH }, outW, outH);
	};
}

/** The file's MIME type. */
export function animMime(format: AnimFormat): string {
	if (format === 'gif') return 'image/gif';
	if (format === 'apng') return 'image/apng';
	return `video/${format}`;
}
