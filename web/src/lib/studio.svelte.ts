// Studio state: the engine client, the current picture, the recipe and the play state. Components stay thin; the rules
// live in the pure modules (presets, naming, settings, export-model, errors).
import { EngineClient } from './engine/client';
import { defaultParams, type Params } from './engine/params';
import { decodeFile, defaultLongEdge } from './engine/image-intake';
import { BUILTIN, diff, mulberry32, roll, type Preset, type Recipe } from './presets';
import { engineErrorCode } from './errors';
import { suggest } from './naming';
import { Autosaver } from './autosave';
import { ServerBackend } from './api';

export type RunState = 'idle' | 'preparing' | 'animating' | 'paused' | 'done' | 'error';

/** A procedural landscape, so Studio is useful before any file is chosen (and tests need no fixture). */
export function sampleImage(w = 960, h = 600): { w: number; h: number; rgba: Uint8ClampedArray } {
	const c = new OffscreenCanvas(w, h);
	const g = c.getContext('2d')!;
	const sky = g.createLinearGradient(0, 0, 0, h * 0.65);
	sky.addColorStop(0, '#f7945e');
	sky.addColorStop(1, '#8c9bb0');
	g.fillStyle = sky;
	g.fillRect(0, 0, w, h);
	g.fillStyle = '#fff0b8';
	g.beginPath();
	g.arc(w * 0.68, h * 0.24, h * 0.11, 0, Math.PI * 2);
	g.fill();
	g.fillStyle = '#2a4a34';
	g.beginPath();
	g.moveTo(0, h * 0.7);
	for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.55 - Math.sin(x / 90) * h * 0.1 - Math.sin(x / 31) * h * 0.04);
	g.lineTo(w, h);
	g.lineTo(0, h);
	g.fill();
	let s = 7;
	for (let i = 0; i < 46; i++) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		g.fillStyle = `hsl(${s % 360} 45% ${30 + ((s >> 8) % 35)}%)`;
		g.fillRect((s >> 4) % w, h * 0.72 + ((s >> 12) % (h * 0.25)), 10 + ((s >> 6) % 50), h);
	}
	return { w, h, rgba: g.getImageData(0, 0, w, h).data };
}

class Studio {
	params = $state<Params>({ ...defaultParams, algo: 'oddeven', mode: 'random', length: 83, randomness: 10 });
	size = $state<{ w: number; h: number } | null>(null);
	original = $state<Uint8ClampedArray | null>(null);
	sorted = $state<Uint8ClampedArray | null>(null);
	run = $state<RunState>('idle');
	progress = $state(0);
	pass = $state(0);
	speed = $state(40);
	presetId = $state<string | null>(null);
	applied = $state<Recipe | null>(null);
	customName = $state<string | null>(null);
	comparing = $state(false);
	errorCode = $state<string | null>(null);
	timings = $state<{ prepareMs: number; sortMs: number } | null>(null);
	onFrame: ((rgba: Uint8ClampedArray, w: number, h: number) => void) | null = null;

	saveFailed = $state(false);
	private server = new ServerBackend();
	private saver = new Autosaver(
		() => this.saveRun(),
		() => (this.saveFailed = true)
	);
	private client: EngineClient | null = null;
	private off: (() => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;

	readonly name = $derived(this.customName ?? suggest(this.params, this.params.seed));
	readonly edited = $derived(this.applied ? diff(this.applied, this.recipe()).length > 0 : false);

	recipe(): Recipe {
		const p = this.params;
		return {
			mode: p.mode,
			length: p.length,
			randomness: p.randomness,
			lo: p.lo,
			hi: p.hi,
			edge: p.edge,
			angle: p.angle,
			key: p.key,
			reverse: p.reverse
		};
	}

	start(): void {
		if (this.client) return;
		this.client = new EngineClient();
		this.off = this.client.onFrame((f) => {
			if (!this.size) return;
			this.sorted = f.rgba;
			this.progress = f.progress;
			this.pass = f.pass;
			this.onFrame?.(f.rgba, this.size.w, this.size.h);
			if (f.done) {
				this.run = 'done';
				this.saver.schedule(this.saveKey(), true);
			}
		});
	}

	stop(): void {
		clearTimeout(this.timer);
		this.saver.cancel();
		this.off?.();
		this.client?.dispose();
		this.client = null;
	}

	async load(img: { w: number; h: number; rgba: Uint8ClampedArray }): Promise<void> {
		this.start();
		this.size = { w: img.w, h: img.h };
		this.original = img.rgba;
		this.sorted = img.rgba;
		this.customName = null;
		try {
			await this.client!.init(img.w, img.h);
			await this.client!.setImage(img.rgba);
			this.onFrame?.(img.rgba, img.w, img.h);
			await this.instant();
		} catch (e) {
			this.fail(e);
		}
	}

	async loadFile(file: Blob & { name?: string }): Promise<void> {
		try {
			const d = await decodeFile(file, defaultLongEdge());
			await this.load({ w: d.w, h: d.h, rgba: d.rgba });
		} catch (e) {
			this.errorCode = 'image-unreadable';
			this.errorName = (file as { name?: string }).name ?? '';
			void e;
		}
	}
	errorName = $state('');

	private fail(e: unknown): void {
		this.errorCode = engineErrorCode(e);
		this.run = 'error';
	}

	/** Called whenever a knob changes: coalesce, then re-sort (or restart the animation if one is running). */
	changed(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(
			() => void (this.run === 'animating' || this.run === 'paused' ? this.play() : this.instant()),
			80
		);
	}

	async instant(): Promise<void> {
		if (!this.client || !this.size) return;
		this.run = 'preparing';
		try {
			await this.client.configure(this.params);
			const r = await this.client.run();
			if (r === 'superseded') return;
			this.sorted = r.rgba;
			this.timings = r.timings;
			this.progress = 1;
			this.run = 'done';
			this.onFrame?.(r.rgba, this.size.w, this.size.h);
			this.saver.schedule(this.saveKey());
		} catch (e) {
			this.fail(e);
		}
	}

	async play(): Promise<void> {
		if (!this.client || !this.size) return;
		try {
			await this.client.configure(this.params);
			this.progress = 0;
			this.pass = 0;
			this.run = 'animating';
			await this.client.animate(this.speed);
		} catch (e) {
			this.fail(e);
		}
	}

	async togglePlay(): Promise<void> {
		if (this.run === 'animating') {
			this.run = 'paused';
			await this.client?.pause();
		} else if (this.run === 'paused') {
			this.run = 'animating';
			await this.client?.resume();
		} else await this.play();
	}

	async restart(): Promise<void> {
		this.progress = 0;
		this.pass = 0;
		this.run = 'animating';
		await this.client?.restart();
	}

	setSpeed(v: number): void {
		this.speed = v;
		void this.client?.setSpeed(v);
	}

	/** What identifies a run: the picture, the recipe, the seed and the engine version. */
	private saveKey(): string {
		const o = this.original;
		return `${this.size?.w}x${this.size?.h}:${o ? o[0]! + ',' + o[o.length >> 1]! : ''}:${JSON.stringify(this.params)}`;
	}

	private async saveRun(): Promise<void> {
		if (!this.size || !this.original || !this.sorted) return;
		const { w, h } = this.size;
		const encode = async (rgba: Uint8ClampedArray, tw: number, th: number, type: string, quality?: number) => {
			const src = new OffscreenCanvas(w, h);
			src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
			const c = new OffscreenCanvas(tw, th);
			c.getContext('2d')!.drawImage(src, 0, 0, tw, th);
			return c.convertToBlob({ type, quality });
		};
		const k = Math.min(1, 320 / Math.max(w, h));
		const [original, result, thumb] = await Promise.all([
			encode(this.original, w, h, 'image/png'),
			encode(this.sorted, w, h, 'image/png'),
			encode(this.sorted, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), 'image/webp', 0.8)
		]);
		await this.server.saveRun({
			settings: { ...this.params },
			seed: this.params.seed,
			engineVersion: '1',
			durationMs: (this.timings?.prepareMs ?? 0) + (this.timings?.sortMs ?? 0),
			original,
			result,
			thumb,
			w,
			h,
			title: this.customName
		});
		this.saveFailed = false;
	}

	applyPreset(p: Preset, seed = Date.now()): void {
		const r = roll(p, mulberry32(seed), this.recipe());
		Object.assign(this.params, r);
		this.presetId = p.id;
		this.applied = r;
		this.changed();
	}

	get preset(): Preset | undefined {
		return BUILTIN.find((p) => p.id === this.presetId);
	}
}

export const studio = new Studio();
