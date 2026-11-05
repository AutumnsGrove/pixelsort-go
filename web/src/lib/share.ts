// Sharing and URL loading: a typed client over /api/features, /api/shares and /api/fetch (docs/api.md). The server holds the
// Worker's address and secret; the browser only ever talks to its own server.
import { ApiError } from './api';
import type { ErrorCode } from './errors';

export type Features = { share: boolean; fetch: boolean };
export type ShareRow = {
	id: string;
	url: string;
	created_at: number;
	expires_at: number | null;
	revoked_at: number | null;
	title: string | null;
	include_recipe: boolean;
	include_original: boolean;
	items: number;
	run_ids: number[];
};
export type ShareOptions = {
	runIds: number[];
	includeRecipe: boolean;
	includeOriginal: boolean;
	/** null = never expires */
	expiresInDays: number | null;
	title?: string;
};
export type Created = { id: string; url: string; expires_at: number | null };

type Fetch = typeof fetch;

/** The body of the create request: plain JSON, or multipart when stripped originals travel with it. */
export function buildCreateRequest(opts: ShareOptions, originals: Map<number, Blob> = new Map()): RequestInit {
	const meta = {
		run_ids: opts.runIds,
		include_recipe: opts.includeRecipe,
		include_original: opts.includeOriginal,
		expires_in_days: opts.expiresInDays,
		title: opts.title ?? ''
	};
	if (!opts.includeOriginal) {
		return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) };
	}
	const form = new FormData();
	form.set('meta', JSON.stringify(meta));
	for (const id of opts.runIds) {
		const blob = originals.get(id);
		if (blob) form.set(`orig-${id}`, blob, `orig-${id}`);
	}
	return { method: 'POST', body: form };
}

/** Expiry choice from Settings ('never' | '30') to the API's number of days. */
export const expiryDays = (choice: 'never' | '30'): number | null => (choice === '30' ? 30 : null);

export class ShareBackend {
	constructor(
		private readonly f: Fetch = (...a) => fetch(...a),
		private readonly base = ''
	) {}

	private async json<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await this.f(this.base + path, init);
		const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
		if (!res.ok)
			throw new ApiError(res.status, body?.error?.code ?? 'internal', body?.error?.message ?? res.statusText);
		return body as T;
	}

	/** Never throws: an old or unreachable server simply has no sharing. */
	async features(): Promise<Features> {
		try {
			const f = await this.json<Features>('/api/features');
			return { share: !!f.share, fetch: !!f.fetch };
		} catch {
			return { share: false, fetch: false };
		}
	}
	async list(): Promise<ShareRow[]> {
		return (await this.json<{ shares: ShareRow[] }>('/api/shares')).shares;
	}
	create(opts: ShareOptions, originals?: Map<number, Blob>): Promise<Created> {
		return this.json('/api/shares', buildCreateRequest(opts, originals));
	}
	async revoke(id: string): Promise<void> {
		await this.json(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
	}

	/** Loads a picture through the relay. Failures carry the Worker's code: link-blocked and friends. */
	async fetchViaRelay(url: string): Promise<Blob> {
		const res = await this.f(this.base + '/api/fetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url })
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
			throw new LinkError(linkCode(body?.error?.code));
		}
		return res.blob();
	}
}

/** A failed URL load, already mapped to a catalog code the dialog can show. */
export class LinkError extends Error {
	constructor(public readonly code: Extract<ErrorCode, `link-${string}`>) {
		super(code);
		this.name = 'LinkError';
	}
}

const LINK_CODES = ['link-blocked', 'link-not-image', 'link-too-large', 'link-timeout'] as const;
export function linkCode(code: string | undefined): (typeof LINK_CODES)[number] {
	return (LINK_CODES as readonly string[]).includes(code ?? '')
		? (code as (typeof LINK_CODES)[number])
		: 'link-blocked';
}

/**
 * Loads a picture from a link: straight from the site when its CORS headers allow it (including your own share links,
 * whose files send CORS *), otherwise through the relay when the server has one.
 */
export async function loadFromUrl(
	url: string,
	opts: { relay?: ShareBackend; features: Features; direct?: Fetch }
): Promise<Blob> {
	const direct = opts.direct ?? ((...a: Parameters<Fetch>) => fetch(...a));
	try {
		const res = await direct(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
		if (res.ok) {
			const blob = await res.blob();
			if (!blob.type.startsWith('image/')) throw new LinkError('link-not-image');
			return blob;
		}
		// the site answered, so the relay would be told the same thing
		throw new LinkError(res.status === 408 ? 'link-timeout' : 'link-blocked');
	} catch (e) {
		if (e instanceof LinkError) throw e;
		// A network or CORS failure looks the same from here: let the relay try if there is one.
		if (opts.features.fetch && opts.relay) return opts.relay.fetchViaRelay(url);
		throw new LinkError('link-blocked');
	}
}

/**
 * Re-encodes an original through a canvas so it carries no EXIF, GPS or other metadata. JPEG stays JPEG, everything
 * else becomes PNG. Browser only (OffscreenCanvas or a DOM canvas).
 */
export async function stripMetadata(original: Blob): Promise<Blob> {
	const bmp = await createImageBitmap(original, { imageOrientation: 'from-image' });
	const type = original.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
	try {
		if (typeof OffscreenCanvas !== 'undefined') {
			const c = new OffscreenCanvas(bmp.width, bmp.height);
			c.getContext('2d')!.drawImage(bmp, 0, 0);
			return await c.convertToBlob({ type, quality: 0.95 });
		}
		const c = document.createElement('canvas');
		c.width = bmp.width;
		c.height = bmp.height;
		c.getContext('2d')!.drawImage(bmp, 0, 0);
		return await new Promise<Blob>((resolve, reject) =>
			c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode'))), type, 0.95)
		);
	} finally {
		bmp.close();
	}
}

/** True when the bytes carry an Exif block or an XMP packet (used by tests and as a last check before upload). */
export function hasMetadata(bytes: Uint8Array): boolean {
	const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
	return text.includes('Exif') || text.includes('http://ns.adobe.com/xap') || /\beXIf\b/.test(text);
}
