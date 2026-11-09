// Feature detection for video export, kept apart from the encoder (which imports Mediabunny) so the panel can ask
// without pulling the muxer into the main bundle. Uses WebCodecs directly.

export type VideoFormat = 'mp4' | 'webm';

export type VideoSupport = {
	mp4: boolean;
	webm: boolean;
	/** Why video formats are unavailable, or null when at least one is. */
	note: string | null;
};

// Standard codec strings for the containers' preferred codecs. Level 4.0 H.264 covers 1080p; VP9 profile 0 level 1.0
// is what browsers accept as a baseline probe.
const PROBES: Record<VideoFormat, string[]> = {
	mp4: ['avc1.420028', 'avc1.42001f'],
	webm: ['vp09.00.10.08', 'vp8']
};

async function probe(codec: string, width: number, height: number, fps: number): Promise<boolean> {
	if (typeof VideoEncoder === 'undefined') return false;
	try {
		const config: VideoEncoderConfig = {
			codec,
			width,
			height,
			bitrate: 2_000_000,
			framerate: Math.max(1, fps)
		};
		return (await VideoEncoder.isConfigSupported(config)).supported === true;
	} catch {
		return false;
	}
}

/** Which video formats this browser can encode at this size and frame rate. */
export async function videoSupport(width: number, height: number, fps: number): Promise<VideoSupport> {
	if (typeof VideoEncoder === 'undefined') {
		return {
			mp4: false,
			webm: false,
			note: 'Video needs WebCodecs, which this browser does not have. GIF and APNG still work.'
		};
	}
	const works = async (format: VideoFormat) =>
		(await Promise.all(PROBES[format].map((c) => probe(c, width, height, fps)))).some(Boolean);
	const [mp4, webm] = await Promise.all([works('mp4'), works('webm')]);
	const any = mp4 || webm;
	return {
		mp4,
		webm,
		note: any ? null : 'This browser cannot encode H.264, VP9 or VP8 video here. GIF and APNG still work.'
	};
}
