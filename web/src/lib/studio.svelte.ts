// Studio state: the engine client, the current picture, the recipe and the play state. Components stay thin; the rules
// live in the pure modules (presets, naming, settings, export-model, errors).
import { EngineClient } from './engine/client';
import { defaultParams, type Params } from './engine/params';
import { decodeFile, defaultLongEdge } from './engine/image-intake';
import { BUILTIN, diff, mulberry32, roll, type Preset, type Recipe } from './presets';
import { engineErrorCode } from './errors';
import { clean, suggest } from './naming';
import { Autosaver } from './autosave';
import { ServerBackend, sha256Hex, type ApiRun } from './api';
import { packRecipe, unpackRecipe } from './run-recipe';
import { cutoutName, outlineSvg, refusalText, TOLERANCE } from './cutout-shape';
import type { CutoutResult } from './engine/client';
import { settings } from './settings.svelte';
import { autoSaveAllowed, saveFailureReason, type SaveState } from './save-policy';
import { LinkError, loadFromUrl, ShareBackend, type Features } from './share';

import { classCount, defaultTiling, type MaskObject, type Stroke, type Tiling } from './regions';
import { toSpec } from './mask-model';
import { acceptGuess, DEFAULT_RADIUS, suggestFor, type Tool } from './brush';
import type { Guess } from './snap';
import { LocalStorageBackend } from './storage';
import { ShapeLibrary, nextShapeName, type SavedShape } from './shape-library';
import type { Ring } from './shape-tidy';
import { cardsToClassDefs, defaultCards, kindCounts, newCard, type RegionCard } from './region-cards';

/** One card per possible kind (the "random" pattern can make eight); the first three start with a little personality. */
function startingCards(): Record<number, RegionCard> {
	const cards = defaultCards();
	for (let k = 4; k <= 8; k++) cards[k] = newCard(`Kind ${k}`);
	return cards;
}

/** The engine's version, stored with every run. A run made by another version may sort differently. */
export const ENGINE_VERSION = '1';

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

/** The bundled first-run photo. Falls back to the procedural sample if it cannot be fetched. */
export async function defaultImage(
	longEdge: number = defaultLongEdge()
): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
	try {
		const res = await fetch('/samples/forest.jpg');
		if (!res.ok) throw new Error(`sample: ${res.status}`);
		return await decodeFile(await res.blob(), longEdge);
	} catch {
		return sampleImage();
	}
}

/** SHA-256 of the pixels, so the save key knows which picture it is, not just how big it is. */
async function fingerprint(rgba: Uint8ClampedArray): Promise<string> {
	const whole = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
	const buf = whole
		? (rgba.buffer as ArrayBuffer)
		: (rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer);
	return (await sha256Hex(buf)).slice(0, 16);
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
	/** The engine download while it is under way (null once the engine runs): the page says "loading the engine" with a percentage. */
	engineLoad = $state<{ loaded: number; total: number | null; attempt: number } | null>(null);
	timings = $state<{ prepareMs: number; sortMs: number } | null>(null);
	onFrame: ((rgba: Uint8ClampedArray, w: number, h: number) => void) | null = null;

	// ---- regions (cut the picture into cells, give each kind of cell its own rules) and protect (freeze shapes) ----
	tiling = $state<Tiling | null>(null);
	/** What each kind of cell does; anything not overridden inherits the global recipe. See region-cards.ts. */
	cards = $state<Record<number, RegionCard>>(startingCards());
	/** Shapes per kind, for the card headers. */
	kindCounts(): Record<number, number> {
		return kindCounts(this.classOf);
	}
	/** The cards as the engine wants them, for the current pattern (class 0, the gaps, first). */
	engineDefs(): object[] {
		return this.tiling ? cardsToClassDefs(this.cards, classCount(this.tiling.pattern, this.tiling.kinds)) : [];
	}
	labels = $state<Uint16Array | null>(null);
	classOf = $state<Uint8Array | null>(null);
	showCells = $state(true);
	/** Counts per 0..255 value of the threshold key, for the band picker; [] until there is a picture. */
	async histogram(): Promise<number[]> {
		if (!this.client || !this.size) return [];
		try {
			return await this.client.histogram(this.params.thresholdKey);
		} catch {
			return [];
		}
	}
	async caRules(): Promise<{ rule: number; note: string }[]> {
		if (!this.client) return [];
		try {
			return await this.client.caRules();
		} catch {
			return [];
		}
	}
	/** What one cellular rule looks like with the knobs as they are right now; null if the engine cannot say (the panel then says so). */
	async caPreview(rule: number): Promise<{ mask: Uint8Array; w: number; h: number } | null> {
		if (!this.client) return null;
		try {
			return await this.client.caPreview({ ...this.params }, rule);
		} catch {
			return null;
		}
	}
	/** Hold T: veil the pixels the recipe holds still. `movable` is the engine's mask, fetched when the key goes down. */
	peeking = $state(false);
	movable = $state<Uint8Array | null>(null);
	async peek(on: boolean): Promise<void> {
		if (!on) {
			this.peeking = false;
			return;
		}
		if (!this.client || !this.size) return;
		try {
			this.movable = await this.client.sortable();
			this.peeking = true;
		} catch {
			this.peeking = false; // nothing to show yet; the sort itself reports real failures
		}
	}
	maskObjects = $state<MaskObject[]>([]);
	/** Index of the mask object being edited on the canvas, or null. */
	selectedMask = $state<number | null>(null);
	maskInvert = $state(false);
	maskFeather = $state(0);
	saveFailed = $state(false);
	/** Why the last save failed, for the error catalog ('disk', 'timeout', or unsaid). */
	saveReason = $state<'disk' | 'timeout' | undefined>(undefined);
	private saving = $state(false);
	/** The look that was last stored, so Save knows whether pressing it again would change anything. */
	private lastSavedKey = $state<string | null>(null);
	/** Fingerprint of the original pixels: two pictures with the same corners are not the same picture. */
	private originalId = $state('');
	/** Bumps whenever the cells or the protected areas change: they are part of the look, but too big to compare each time. */
	private rev = $state(0);
	/** The run this look was opened from (or last saved as), so the next save is recorded as its child. The opened run is never changed. */
	parentRunId = $state<number | null>(null);
	/** Set when the opened run was made by another engine version: the page says it may look different. */
	engineNote = $state<string | null>(null);
	/** A knob moved and the re-sort has not finished: what is on screen is not yet the look the knobs describe. */
	pendingChange = $state(false);
	private changeSeq = 0;
	/** True while the picture is the bundled demo and nobody has touched anything: the demo is never stored by itself. */
	isSample = $state(false);
	private server = new ServerBackend();
	private saver = new Autosaver(
		() => this.saveRun(),
		() => (this.saveFailed = true)
	);
	private client: EngineClient | null = null;
	private off: (() => void) | null = null;
	private offLoading: (() => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;

	readonly name = $derived(this.customName ?? suggest(this.params, this.params.seed));

	// ---- renaming: one draft, shown by whichever name control started it (the caption, or the phone sheet's header) ----
	renameFrom = $state<'caption' | 'sheet' | null>(null);
	nameDraft = $state('');
	startRename(from: 'caption' | 'sheet' = 'caption'): void {
		this.nameDraft = this.name;
		this.renameFrom = from;
	}
	/** Saves the draft (tidied like the server does); an empty draft goes back to the automatic name. */
	commitRename(): void {
		this.customName = clean(this.nameDraft) || null;
		this.renameFrom = null;
	}
	cancelRename(): void {
		this.renameFrom = null;
	}
	/** This exact look (picture, recipe, cells, protected areas) is not in the Archive yet. */
	readonly dirty = $derived(this.size !== null && this.saveKey() !== this.lastSavedKey);
	readonly saveStatus = $derived<SaveState>(
		this.saving ? 'saving' : this.dirty ? (this.saveFailed ? 'failed' : 'unsaved') : 'saved'
	);
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
		this.offLoading = this.client.onLoading((p) => (this.engineLoad = p));
		this.off = this.client.onFrame((f) => {
			if (!this.size || this.scrubbed) return;
			this.sorted = f.rgba;
			this.progress = f.progress;
			this.pass = f.pass;
			this.maxPass = Math.max(this.maxPass, f.pass);
			this.onFrame?.(f.rgba, this.size.w, this.size.h);
			if (f.done) {
				this.run = 'done';
				if (this.autoSaving()) this.saver.schedule(this.saveKey(), true);
			}
		});
	}

	stop(): void {
		clearTimeout(this.timer);
		this.saver.cancel();
		this.off?.();
		this.offLoading?.();
		this.engineLoad = null;
		this.client?.dispose();
		this.client = null;
	}

	/**
	 * Starts the engine worker over (it downloads the engine again) and puts the picture back, keeping the recipe, the name
	 * and everything the person set up. This is what "Try again" does after the engine failed to download or crashed.
	 */
	async restartEngine(): Promise<void> {
		this.errorCode = null;
		const name = this.customName;
		const sample = this.isSample;
		const parent = this.parentRunId;
		const note = this.engineNote;
		this.stop();
		const img =
			this.original && this.size ? { w: this.size.w, h: this.size.h, rgba: this.original } : await defaultImage();
		await this.load(img, { sample });
		this.customName = name;
		this.parentRunId = parent;
		this.engineNote = note;
	}

	async load(img: { w: number; h: number; rgba: Uint8ClampedArray }, opts: { sample?: boolean } = {}): Promise<void> {
		this.start();
		// Hash first: the size, the original and the sorted pixels must change in one step, or for a moment the page holds
		// the new size with the old pixels and drawing them throws.
		const id = await fingerprint(img.rgba);
		this.size = { w: img.w, h: img.h };
		this.original = img.rgba;
		this.sorted = img.rgba;
		this.isSample = opts.sample === true;
		this.originalId = id;
		this.parentRunId = null;
		this.engineNote = null;
		this.clearCutout(); // a region belongs to the picture it was cut from
		this.customName = null;
		try {
			await this.client!.init(img.w, img.h);
			await this.client!.setImage(img.rgba);
			// A new picture resets the engine session, so the cells and the protected shapes (vector specs) are sent again.
			if (this.tiling) {
				const r = await this.client!.setTiling({ ...this.tiling }, this.engineDefs());
				this.labels = r?.labels ?? null;
				this.classOf = r?.classOf ?? null;
			}
			if (this.hasMask()) await this.client!.setMaskSpec(this.maskSpec());
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

	/** Loads a picture from a link: straight from the site, or through the server's relay. A failure becomes a catalog dialog. */
	async loadUrl(url: string, features: Features): Promise<void> {
		let parsed: URL;
		try {
			parsed = new URL(url.trim());
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
		} catch {
			this.errorCode = 'link-not-image';
			return;
		}
		try {
			const blob = await loadFromUrl(parsed.toString(), { relay: new ShareBackend(), features });
			const name = decodeURIComponent(parsed.pathname.split('/').pop() ?? '') || 'link';
			await this.loadFile(Object.assign(blob, { name }));
		} catch (e) {
			this.errorCode = e instanceof LinkError ? e.code : 'link-blocked';
		}
	}

	private fail(e: unknown): void {
		this.errorCode = engineErrorCode(e);
		this.run = 'error';
	}

	/** Called whenever a knob changes: coalesce, then re-sort (or restart the animation if one is running). */
	changed(): void {
		this.isSample = false;
		// From the change until its re-sort has finished, the picture on screen is the old sort of the old recipe: Save waits.
		this.pendingChange = true;
		const seq = ++this.changeSeq;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			const again = this.run === 'animating' || this.run === 'paused' ? this.play() : this.instant();
			void again.finally(() => {
				if (seq === this.changeSeq) this.pendingChange = false; // a newer change keeps it set
			});
		}, 80);
	}

	async instant(): Promise<void> {
		if (!this.client || !this.size) return;
		this.stepped = false;
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
			if (this.autoSaving()) this.saver.schedule(this.saveKey());
		} catch (e) {
			this.fail(e);
		}
	}

	async play(): Promise<void> {
		if (!this.client || !this.size) return;
		this.isSample = false;
		try {
			await this.client.configure(this.params);
			this.progress = 0;
			this.pass = 0;
			this.maxPass = 0;
			this.stepped = true;
			this.scrubbed = false;
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
			this.scrubbed = false; // frames flow again from wherever the slider left the sort
			await this.client?.resume();
		} else await this.play();
	}

	// ---- scrubbing: drag through the sort. The engine replays deterministically (it never stores a frame per step). ----
	/** A stepped sort exists (an animation was started and the picture has not been replaced by an instant sort since). */
	stepped = $state(false);
	/** The furthest pass seen so far, or the total once the sort finished: the slider's end. */
	maxPass = $state(0);
	private scrubbed = false;
	get scrubbable(): boolean {
		return (
			this.stepped && (this.run === 'animating' || this.run === 'paused' || this.run === 'done') && this.maxPass > 0
		);
	}
	/** Jump to the state after `pass` passes. Pauses the animation; newer calls replace older ones still waiting. */
	async scrub(pass: number): Promise<void> {
		if (!this.client || !this.size || !this.stepped) return;
		this.isSample = false;
		this.scrubbed = true; // a frame still in flight from before must not overwrite what the slider shows
		if (this.run === 'animating') this.run = 'paused';
		try {
			const r = await this.client.seek(Math.max(0, Math.round(pass)));
			if (r === 'superseded') return;
			this.sorted = r.rgba;
			this.progress = r.progress;
			this.pass = r.pass;
			this.maxPass = Math.max(this.maxPass, r.pass);
			this.run = r.done ? 'done' : 'paused';
			this.onFrame?.(r.rgba, this.size.w, this.size.h);
		} catch (e) {
			this.fail(e);
		}
	}

	async restart(): Promise<void> {
		this.isSample = false;
		this.progress = 0;
		this.pass = 0;
		this.maxPass = 0;
		this.scrubbed = false;
		this.run = 'animating';
		await this.client?.restart();
	}

	setSpeed(v: number): void {
		this.speed = v;
		void this.client?.setSpeed(v);
	}

	/** Sends the tiling and its class rules to the engine, then re-sorts. */
	async applyRegions(): Promise<void> {
		if (!this.client || !this.size) return;
		this.isSample = false;
		this.rev++;
		try {
			const t = this.tiling;
			const r = await this.client.setTiling(t ? { ...t } : null, t ? this.engineDefs() : null);
			this.labels = r?.labels ?? null;
			this.classOf = r?.classOf ?? null;
			await this.instant();
		} catch (e) {
			this.fail(e);
		}
	}

	setTilingShape(shape: Tiling['shape'] | null): void {
		this.tiling = shape ? { ...(this.tiling ?? defaultTiling(shape, this.params.seed)), shape } : null;
		void this.applyRegions();
	}

	// ---- the shape library: starters and "your shapes" tile the picture as a custom shape ----
	private shapeLib = new ShapeLibrary(this.server, new LocalStorageBackend());
	myShapes = $state<SavedShape[]>([]);
	// ---- Shape helper, "Cut out this object": a region grown from a click, traced by the engine, offered as a shape ----
	/** How far a colour may stray from the clicked spot and still be part of the shape. */
	cutTol = $state<number>(TOLERANCE.start);
	/** Waiting for a click on the picture. */
	picking = $state(false);
	/** The last cut-out: where it was asked for, and either the region or why there is none. */
	cutout = $state<
		| { x: number; y: number; found: Extract<CutoutResult, { ok: true }>; name: string }
		| { x: number; y: number; found: null; refusal: string }
		| null
	>(null);
	/** Cuts out around a point given as fractions of the picture (0..1). Never changes the picture or the recipe. */
	async cutOutAt(x: number, y: number): Promise<void> {
		if (!this.client || !this.size) return;
		try {
			const r = await this.client.cutOut(x, y, this.cutTol);
			this.cutout = r.ok
				? { x, y, found: r, name: cutoutName(r.mean) }
				: { x, y, found: null, refusal: refusalText(r.reason) };
		} catch (e) {
			this.fail(e);
		}
	}
	/** Cuts out the brightest blob of the picture (the engine says where it is). */
	async cutOutBrightest(): Promise<void> {
		if (!this.client || !this.size) return;
		try {
			const s = await this.client.brightestSpot();
			await this.cutOutAt(s.cx, s.cy);
		} catch (e) {
			this.fail(e);
		}
	}
	clearCutout(): void {
		this.cutout = null;
		this.picking = false;
	}
	/** Offers the cut-out to the shape library under `name`: it goes through the same reading, tidying and saving as a pasted SVG. */
	useCutout(name: string): void {
		const c = this.cutout?.found;
		if (!c) return;
		this.pendingSvgName = name.trim() || null;
		this.pendingSvg = outlineSvg(c.outline, c.bbox);
		this.clearCutout();
	}
	/** SVG text dropped or pasted anywhere in Studio, waiting for the shape library to read it (never loaded as the picture). */
	pendingSvg = $state<string | null>(null);
	/** The name to give the shape in `pendingSvg`, when the maker of the SVG has one (the Shape helper does). */
	pendingSvgName = $state<string | null>(null);
	/** The shape (outline and extra rings) the custom tiling currently uses, for highlighting the chosen tile. */
	customKey = $state<string | null>(null);

	async loadMyShapes(): Promise<void> {
		const before = this.myShapes;
		const list = await this.shapeLib.list();
		// A shape saved while the list was on its way (a dropped SVG opens the library and adds at once) must not be wiped by it.
		const have = new Set(list.map((s) => s.id));
		const added = this.myShapes.filter((s) => !before.includes(s) && !have.has(s.id));
		this.myShapes = [...added, ...list];
	}
	/** Tile the picture with this outline (plus holes or extra pieces). `key` names the library tile that is now chosen. */
	useShape(poly: Ring, more: Ring[], key: string | null): void {
		const base = this.tiling ?? defaultTiling('custom', this.params.seed);
		this.tiling = { ...base, shape: 'custom', poly, more };
		this.customKey = key;
		void this.applyRegions();
	}
	setStagger(stagger: boolean): void {
		if (!this.tiling) return;
		this.tiling = { ...this.tiling, stagger };
		void this.applyRegions();
	}
	/** Save a shape to "your shapes" (server, or this browser if the server is away) and use it. */
	async saveShape(name: string, poly: Ring, more: Ring[]): Promise<void> {
		const saved = await this.shapeLib.add(name || nextShapeName(this.myShapes), poly, more);
		this.myShapes = [saved, ...this.myShapes];
		this.useShape(saved.poly, saved.more, saved.id);
	}
	async deleteShape(shape: SavedShape): Promise<void> {
		try {
			await this.shapeLib.remove(shape);
		} catch {
			return;
		}
		this.myShapes = this.myShapes.filter((s) => s.id !== shape.id);
		if (this.customKey === shape.id) this.customKey = null;
	}

	/** Sends the mask objects as a vector spec; the engine rasterises them at whatever size it is working at. */
	async applyMask(): Promise<void> {
		if (!this.client || !this.size) return;
		this.isSample = false;
		this.rev++;
		try {
			await this.client.setMaskSpec(this.hasMask() ? this.maskSpec() : null);
			await this.instant();
		} catch (e) {
			this.fail(e);
		}
	}

	private hasMask(): boolean {
		return this.maskObjects.length > 0 || this.maskStrokes.length > 0 || this.maskInvert;
	}
	private maskSpec(): object {
		return toSpec(this.maskObjects, this.maskInvert, this.maskFeather, this.maskStrokes);
	}

	// ---- painting: brush strokes protect (paint) or unprotect (erase) pixels; a loop can become an object ----
	maskStrokes = $state<Stroke[]>([]);
	tool = $state<Tool>('move');
	brushRadius = $state(DEFAULT_RADIUS);
	/** A finished paint stroke that looks like a circle or rectangle, offered as "Snap". */
	suggestion = $state<{ index: number; guess: Guess } | null>(null);

	/** A finished stroke: keep it, offer a snap if it is a loop, and re-sort. */
	addStroke(stroke: Stroke): void {
		this.maskStrokes.push(stroke);
		const g = this.size ? suggestFor(stroke, this.size) : null;
		this.suggestion = g ? { index: this.maskStrokes.length - 1, guess: g } : null;
		void this.applyMask();
	}
	/** Replace the suggested stroke with an editable object (never both). */
	snapSuggestion(): void {
		const s = this.suggestion;
		if (!s) return;
		const { strokes, object } = acceptGuess(this.maskStrokes, s.index, s.guess);
		this.maskStrokes = strokes;
		this.maskObjects.push(object);
		this.selectedMask = this.maskObjects.length - 1;
		this.suggestion = null;
		this.tool = 'move';
		void this.applyMask();
	}
	clearStrokes(): void {
		this.maskStrokes = [];
		this.suggestion = null;
		void this.applyMask();
	}

	addMaskObject(kind: MaskObject['kind'], over?: Partial<MaskObject>): void {
		this.maskObjects.push({
			kind,
			cx: 0.5,
			cy: 0.5,
			w: 0.3,
			h: 0.3 * ((this.size?.w ?? 1) / (this.size?.h ?? 1)),
			rot: 0,
			mode: 'add',
			...over
		});
		void this.applyMask();
	}

	async protectBrightestSpot(): Promise<void> {
		if (!this.client) return;
		const s = await this.client.brightestSpot();
		this.addMaskObject('ellipse', { cx: s.cx, cy: s.cy, w: s.w, h: s.h });
	}

	/** What identifies a look: the picture, the recipe (seed included), and the cells and protected areas. */
	private saveKey(): string {
		return `${this.originalId}:${this.size?.w}x${this.size?.h}:${this.rev}:${JSON.stringify(this.params)}`;
	}
	/** The key the page uses to tell one look from the next (leave warnings). */
	get lookKey(): string {
		return this.saveKey();
	}

	private autoSaving(): boolean {
		return autoSaveAllowed({ autoSave: settings.autoSave, isSample: this.isSample });
	}

	/**
	 * Stores the current look once, now (the Save button, and Export). 'unchanged' means this exact look is already in the
	 * Archive, so nothing is sent. With `report`, a failure opens the "couldn't save" dialog; without it (Export) the
	 * download carries on and the Save button turns into "Retry save".
	 */
	async save(report = false): Promise<'saved' | 'unchanged' | 'failed' | 'busy'> {
		if (!this.size || !this.original || !this.sorted || this.saving) return 'busy';
		if (this.saveKey() === this.lastSavedKey) return 'unchanged';
		this.isSample = false;
		this.saving = true;
		try {
			await this.saveRun();
			return 'saved';
		} catch (e) {
			this.saveFailed = true;
			this.saveReason = saveFailureReason(e);
			if (report) this.errorCode = 'save-failed';
			return 'failed';
		} finally {
			this.saving = false;
		}
	}

	private async saveRun(): Promise<void> {
		if (!this.size || !this.original || !this.sorted) return;
		const key = this.saveKey(); // changes made while this uploads are a new look, not part of this save
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
		const saved = await this.server.saveRun({
			settings: packRecipe({
				params: { ...this.params },
				tiling: this.tiling,
				cards: this.cards,
				mask: this.hasMask()
					? { objects: this.maskObjects, strokes: this.maskStrokes, invert: this.maskInvert, feather: this.maskFeather }
					: null
			}),
			seed: this.params.seed,
			engineVersion: ENGINE_VERSION,
			durationMs: (this.timings?.prepareMs ?? 0) + (this.timings?.sortMs ?? 0),
			original,
			result,
			thumb,
			w,
			h,
			title: this.customName,
			parentRunId: this.parentRunId
		});
		// the next save in this session is a child of this one: a line of versions, each pointing at the one before
		if (typeof saved?.id === 'number') this.parentRunId = saved.id;
		this.lastSavedKey = key;
		this.saveFailed = false;
	}

	/**
	 * Opens a saved run in Studio: the stored original at the working size, then the whole look (knobs, cells, region
	 * cards, protected areas) and the name. The run is never changed: the next save is a new run whose parent is this one.
	 * An older run without cells or masks opens as just its knobs.
	 */
	async openRun(
		run: Pick<ApiRun, 'id' | 'original' | 'settings' | 'title'> & { engine_version?: string }
	): Promise<void> {
		this.errorCode = null;
		let img: { w: number; h: number; rgba: Uint8ClampedArray };
		try {
			const res = await fetch(this.server.imageUrl(run.original.sha256));
			if (!res.ok) throw new Error('missing');
			const d = await decodeFile(await res.blob(), defaultLongEdge());
			img = { w: d.w, h: d.h, rgba: d.rgba };
		} catch {
			this.errorCode = 'image-unreadable';
			this.errorName = run.title ?? 'that run';
			return;
		}
		const look = unpackRecipe(run.settings);
		Object.assign(this.params, look.params);
		this.tiling = look.tiling;
		this.cards = { ...startingCards(), ...(look.cards ?? {}) };
		this.maskObjects = look.mask?.objects ?? [];
		this.maskStrokes = look.mask?.strokes ?? [];
		this.maskInvert = look.mask?.invert ?? false;
		this.maskFeather = look.mask?.feather ?? 0;
		this.selectedMask = null;
		this.suggestion = null;
		this.customKey = null;
		this.presetId = null;
		this.applied = null;
		this.rev++;
		await this.load(img);
		this.customName = run.title;
		this.parentRunId = run.id;
		this.engineNote = run.engine_version && run.engine_version !== ENGINE_VERSION ? run.engine_version : null;
		this.lastSavedKey = this.saveKey(); // this is exactly what is stored: nothing to save until something changes
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
