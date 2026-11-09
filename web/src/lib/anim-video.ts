// MP4/WebM export through WebCodecs and Mediabunny. The frames are drawn into an OffscreenCanvas and Mediabunny encodes
// and muxes them; nothing here works without VideoEncoder, so the panel asks videoSupport() before offering a format.
import {
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	Quality,
	WebMOutputFormat,
	canEncodeVideo,
	type VideoCodec
} from 'mediabunny';
import type { FrameImage } from './anim-frame';
import type { AnimEncoder } from './export-anim';

import type { VideoFormat } from './anim-video-support';

export type { VideoFormat };

/** The codecs Mediabunny should try for each container, best first. */
const CODECS: Record<VideoFormat, VideoCodec[]> = { mp4: ['avc'], webm: ['vp9', 'vp8'] };

async function pick(format: VideoFormat, width: number, height: number, fps: number): Promise<VideoCodec | null> {
	if (typeof VideoEncoder === 'undefined') return null;
	for (const codec of CODECS[format]) {
		try {
			if (await canEncodeVideo(codec, { width, height, frameRate: fps, quality: new Quality('high') })) return codec;
		} catch {
			// A codec string the browser rejects is simply not available.
		}
	}
	return null;
}

/** Streams one MP4 or WebM, drawing each frame into the canvas Mediabunny reads. */
export class VideoEncoderStream implements AnimEncoder {
	private readonly target = new BufferTarget();
	private readonly output: Output;
	private readonly canvas: OffscreenCanvas;
	private readonly ctx: OffscreenCanvasRenderingContext2D;
	private readonly source: CanvasSource;
	private time = 0;
	private started = false;

	constructor(
		private readonly format: VideoFormat,
		codec: VideoCodec,
		private readonly width: number,
		private readonly height: number,
		fps: number
	) {
		this.canvas = new OffscreenCanvas(width, height);
		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context for the animation');
		this.ctx = ctx;
		// fastStart puts the MP4's index at the front so the file plays before it has fully loaded.
		const fmt = format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
		this.output = new Output({ format: fmt, target: this.target });
		this.source = new CanvasSource(this.canvas, { codec, quality: new Quality('high') });
		this.output.addVideoTrack(this.source, { frameRate: fps });
	}

	async addFrame(frame: FrameImage, delayMs: number): Promise<void> {
		if (frame.w !== this.width || frame.h !== this.height)
			throw new Error(`video frame is not ${this.width}x${this.height}`);
		this.ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.w, frame.h), 0, 0);
		if (!this.started) {
			await this.output.start();
			this.started = true;
		}
		const duration = Math.max(0.001, delayMs / 1000);
		await this.source.add(this.time, duration);
		this.time += duration;
	}

	async finish(): Promise<Blob> {
		if (!this.started) await this.output.start();
		await this.output.finalize();
		const buffer = this.target.buffer;
		if (!buffer) throw new Error('the video encoder produced no file');
		return new Blob([buffer], { type: this.output.format.mimeType || `video/${this.format}` });
	}
}

/** The first codec this browser can encode for a container, or null. */
export { pick as pickVideoCodec };
