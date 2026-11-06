// The Shape helper's model half: ask the server (which holds the OpenRouter key) which object in the picture to turn into a shape.
// What leaves the device is a small copy of the picture, made from its pixels alone, plus the request. The model only proposes;
// the page cuts the shape out itself, so nothing is added until the person presses "Use it".

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HelperProposal = {
	region: string;
	name: string;
	seed_x: number;
	seed_y: number;
	tolerance: number;
	area_pct: number;
	colour: string;
};

export type HelperEvent = {
	type: 'start' | 'say' | 'tool_start' | 'tool_end' | 'proposal' | 'done';
	model?: string;
	text?: string;
	id?: string;
	name?: string;
	args?: unknown;
	result?: string;
	is_error?: boolean;
	ms?: number;
	proposal?: HelperProposal;
	reason?: string;
};

/** The longest side of the copy that is sent. */
export const HELPER_COPY_SIDE = 512;
/** The longest request the server accepts. */
export const HELPER_PROMPT_MAX = 500;

/** A run that did not complete. `code` is the server's word (busy, no_vision, ...) or ours (network, bad_stream). */
export class HelperError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 0
	) {
		super(message);
		this.name = 'HelperError';
	}
}

/** Whether this server has the Shape helper. An old or unreachable server simply has none. */
export async function helperEnabled(f: Fetch = (...a) => fetch(...a)): Promise<boolean> {
	try {
		const res = await f('/api/features');
		if (!res.ok) return false;
		return ((await res.json()) as { helper?: unknown }).helper === true;
	} catch {
		return false;
	}
}

/**
 * Asks, and calls `onEvent` for each line the server streams. Resolves when the run ends with `done`; rejects with a
 * HelperError otherwise, or with an AbortError when `signal` fires (which is the person pressing Stop, not a failure).
 */
export async function askHelper(o: {
	prompt: string;
	image: Blob;
	onEvent: (e: HelperEvent) => void;
	signal?: AbortSignal;
	fetchFn?: Fetch;
}): Promise<void> {
	const f = o.fetchFn ?? ((...a: Parameters<Fetch>) => fetch(...a));
	const form = new FormData();
	form.set('prompt', o.prompt);
	form.set('image', o.image, 'copy.jpg');
	let res: Response;
	try {
		res = await f('/api/helper', { method: 'POST', body: form, signal: o.signal, credentials: 'same-origin' });
	} catch (e) {
		if (isAbort(e)) throw e;
		throw new HelperError('network', 'could not reach the server');
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
		throw new HelperError(body?.error?.code ?? 'internal', body?.error?.message ?? res.statusText, res.status);
	}
	if (!res.body) throw new HelperError('bad_stream', 'the answer had no body');
	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let buf = '';
	let finished = false;
	const emit = (text: string): void => {
		if (!text.trim()) return;
		let e: HelperEvent;
		try {
			e = JSON.parse(text) as HelperEvent;
		} catch {
			throw new HelperError('bad_stream', 'the answer was not readable');
		}
		if (!e || typeof e.type !== 'string') throw new HelperError('bad_stream', 'the answer was not readable');
		if (e.type === 'done') finished = true;
		o.onEvent(e);
	};
	const onAbort = (): void => void reader.cancel().catch(() => {});
	o.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		for (;;) {
			if (o.signal?.aborted) throw new DOMException('stopped', 'AbortError');
			const { value, done } = await reader.read().catch((e) => {
				if (isAbort(e) || o.signal?.aborted) throw new DOMException('stopped', 'AbortError');
				throw new HelperError('network', 'the connection dropped');
			});
			if (value) buf += dec.decode(value, { stream: !done });
			let nl: number;
			while ((nl = buf.indexOf('\n')) >= 0) {
				emit(buf.slice(0, nl));
				buf = buf.slice(nl + 1);
			}
			if (done) break;
		}
		emit(buf);
	} finally {
		o.signal?.removeEventListener('abort', onAbort);
	}
	if (o.signal?.aborted) throw new DOMException('stopped', 'AbortError');
	if (!finished) throw new HelperError('bad_stream', 'the answer stopped early');
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** A small JPEG of the working picture for the helper. Re-drawn from pixels, so no metadata can come along. */
export async function helperCopy(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
	const k = Math.min(1, HELPER_COPY_SIDE / Math.max(w, h));
	const tw = Math.max(1, Math.round(w * k));
	const th = Math.max(1, Math.round(h * k));
	const src = new OffscreenCanvas(w, h);
	src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
	const out = new OffscreenCanvas(tw, th);
	const ctx = out.getContext('2d')!;
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, tw, th);
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, tw, th);
	return out.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

const LABELS: Record<string, string> = {
	describe_image: 'Looking at the picture',
	list_objects: 'Listing what is in it',
	segment_from_point: 'Checking an area',
	propose_shape: 'Choosing a shape'
};
/** What a tool call is doing, in words for the transcript. */
export const stepLabel = (name: string): string => LABELS[name] ?? 'Working';

/** One sentence for a failed run. */
export function helperErrorText(e: unknown): string {
	const err = e instanceof HelperError ? e : new HelperError('internal', '');
	switch (err.code) {
		case 'network':
			return 'Could not reach the server. Nothing was added. Try again in a moment.';
		case 'bad_stream':
			return 'The helper’s answer was cut off. Nothing was added. Try again.';
		case 'busy':
			return 'The helper is busy right now. Try again in a few seconds.';
		case 'no_vision':
			return 'The model this server uses cannot see pictures, so the helper cannot work here. “Cut out this object” still works.';
		case 'model_unavailable':
			return 'The helper’s model is not available right now. Try again later, or use “Cut out this object”.';
		case 'bad_prompt':
		case 'bad_image':
		case 'image_too_large':
			return err.message || 'The helper could not use that request.';
		default:
			return 'The helper hit a problem. Nothing was added. Try again.';
	}
}
