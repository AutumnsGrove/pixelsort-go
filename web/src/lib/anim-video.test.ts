import { describe, expect, it } from 'vitest';
import { videoSupport } from '#lib/anim-video-support';

// Vitest runs in Node, which has no WebCodecs: the feature must switch itself off with an explanation, not throw.
describe('video support', () => {
	it('reports both video formats unavailable without WebCodecs', async () => {
		const s = await videoSupport(640, 360, 24);
		expect(s.mp4).toBe(false);
		expect(s.webm).toBe(false);
		expect(s.note).toContain('WebCodecs');
	});
});
