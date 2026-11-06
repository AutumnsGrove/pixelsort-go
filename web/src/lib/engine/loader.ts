// Downloads engine.wasm like a network call, not a hope: a quiet connection is abandoned after `stallMs`, a failure gets
// one more try, and progress is reported while bytes arrive. Pure (no worker, no DOM) so it can be tested with a fake fetch.

/** Thrown when the engine file could not be downloaded, so the page can say "the download failed", not "the engine crashed". */
export class EngineDownloadFailed extends Error {
	constructor(
		url: string,
		readonly attempts: number,
		/** 'timeout', 'http 502', or 'network'. */
		readonly reason: string
	) {
		super(`could not download ${url} (${reason}, ${attempts} ${attempts === 1 ? 'try' : 'tries'})`);
		this.name = 'EngineDownloadFailed';
	}
}

export type LoadProgress = {
	/** Bytes received so far, decoded (what the file will be once loaded). */
	loaded: number;
	/** The decoded size, or null when the server did not say. */
	total: number | null;
	/** 1 for the first try, 2 for the retry. */
	attempt: number;
};

export type FetchEngineOptions = {
	fetchFn?: typeof fetch;
	/** Give up on a try when no bytes arrive for this long. Default 15 s. */
	stallMs?: number;
	/** Extra tries after the first. Default 1. */
	retries?: number;
	/** Wait before a retry. Default 800 ms. */
	retryDelayMs?: number;
	onProgress?: (p: LoadProgress) => void;
	signal?: AbortSignal;
};

class Stalled extends Error {}

/** Decoded size: the server's X-Uncompressed-Length when it compressed the file (fetch hands us decoded bytes), else Content-Length. */
function totalOf(res: Response): number | null {
	for (const h of ['X-Uncompressed-Length', 'Content-Length']) {
		const n = Number(res.headers.get(h));
		if (res.headers.get(h) && Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

async function attemptOnce(
	url: string,
	attempt: number,
	o: Required<Pick<FetchEngineOptions, 'stallMs'>> & FetchEngineOptions
): Promise<ArrayBuffer> {
	const ctl = new AbortController();
	const onOuterAbort = (): void => ctl.abort();
	o.signal?.addEventListener('abort', onOuterAbort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stalled = false;
	const arm = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			stalled = true;
			ctl.abort();
		}, o.stallMs);
	};
	try {
		arm();
		const res = await (o.fetchFn ?? fetch)(url, { signal: ctl.signal });
		if (!res.ok) throw new EngineDownloadFailed(url, attempt, `http ${res.status}`);
		const total = totalOf(res);
		const report = (loaded: number): void => o.onProgress?.({ loaded, total, attempt });
		report(0);
		if (!res.body) {
			const buf = await res.arrayBuffer();
			report(buf.byteLength);
			return buf;
		}
		const reader = res.body.getReader();
		// A real response body is tied to the fetch signal, but do not depend on it: race every read against the abort.
		const aborted = new Promise<never>((_, reject) => {
			ctl.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
		});
		aborted.catch(() => void reader.cancel().catch(() => {}));
		const parts: Uint8Array[] = [];
		let loaded = 0;
		for (;;) {
			const { done, value } = await Promise.race([reader.read(), aborted]);
			if (done) break;
			arm();
			parts.push(value);
			loaded += value.byteLength;
			report(loaded);
		}
		const out = new Uint8Array(loaded);
		let at = 0;
		for (const p of parts) {
			out.set(p, at);
			at += p.byteLength;
		}
		return out.buffer;
	} catch (e) {
		if (stalled) throw new Stalled();
		throw e;
	} finally {
		clearTimeout(timer);
		o.signal?.removeEventListener('abort', onOuterAbort);
	}
}

/** Fetches `url` with a stall timeout and `retries` more tries. Rejects with EngineDownloadFailed, or the abort if `signal` fires. */
export async function fetchEngine(url: string, opts: FetchEngineOptions = {}): Promise<ArrayBuffer> {
	const o = { ...opts, stallMs: opts.stallMs ?? 15_000 };
	const tries = 1 + (opts.retries ?? 1);
	let reason = 'network';
	for (let attempt = 1; attempt <= tries; attempt++) {
		try {
			return await attemptOnce(url, attempt, o);
		} catch (e) {
			if (opts.signal?.aborted) throw e;
			reason = e instanceof EngineDownloadFailed ? e.reason : e instanceof Stalled ? 'timeout' : 'network';
			if (attempt < tries) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800));
		}
	}
	throw new EngineDownloadFailed(url, tries, reason);
}
