// The server storage backend: a thin typed client over the gallery API (docs/api.md). Errors are mapped to the web error
// catalog's codes; the caller never sees a raw response.
import type { ErrorCode } from './errors';

export type ApiImage = { sha256: string; mime: string; w: number; h: number; bytes: number };
export type ApiRun = {
	id: number;
	created_at: number;
	original: ApiImage;
	result: ApiImage;
	thumb: ApiImage;
	settings: Record<string, unknown>;
	seed: number;
	engine_version: string;
	duration_ms: number;
	parent_run_id: number | null;
	starred: boolean;
	title: string | null;
	notes: string | null;
	trashed_at: number | null;
	tags: string[];
};
export type Usage = { used_bytes: number; budget_bytes: number; trash_bytes: number; runs: number; trash_runs: number };

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
	/** The catalog code the UI should show for a failed save. */
	get catalog(): ErrorCode {
		return 'save-failed';
	}
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Fetch = typeof fetch;

export class ServerBackend {
	constructor(
		private readonly f: Fetch = (...a) => fetch(...a),
		private readonly base = ''
	) {}

	private async json<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await this.f(this.base + path, init);
		if (res.status === 204) return undefined as T;
		const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
		if (!res.ok)
			throw new ApiError(res.status, body?.error?.code ?? 'internal', body?.error?.message ?? res.statusText);
		return body as T;
	}
	private post<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
		return this.json<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	}

	/** One page; call again with next_cursor until it is null. */
	listRuns(
		q: {
			cursor?: string;
			limit?: number;
			q?: string;
			starred?: boolean;
			trashed?: '0' | '1' | 'any';
			sort?: string;
		} = {}
	): Promise<{ runs: ApiRun[]; next_cursor: string | null }> {
		const p = new URLSearchParams();
		if (q.cursor) p.set('cursor', q.cursor);
		if (q.limit) p.set('limit', String(q.limit));
		if (q.q) p.set('q', q.q);
		if (q.starred) p.set('starred', '1');
		if (q.trashed) p.set('trashed', q.trashed);
		if (q.sort) p.set('sort', q.sort);
		return this.json(`/api/runs?${p}`);
	}
	async allRuns(q: Parameters<ServerBackend['listRuns']>[0] = {}): Promise<ApiRun[]> {
		const out: ApiRun[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.listRuns({ ...q, cursor, limit: 200 });
			out.push(...page.runs);
			cursor = page.next_cursor ?? undefined;
		} while (cursor);
		return out;
	}
	getRun(id: number): Promise<ApiRun> {
		return this.json(`/api/runs/${id}`);
	}
	patchRun(id: number, patch: { starred?: boolean; title?: string; notes?: string; tags?: string[] }): Promise<ApiRun> {
		return this.post(`/api/runs/${id}`, patch, 'PATCH');
	}
	async trash(ids: number[], confirmStarred = false): Promise<void> {
		await this.post('/api/runs/trash', { ids, confirm_starred: confirmStarred });
	}
	async restore(ids: number[]): Promise<void> {
		await this.post('/api/runs/restore', { ids });
	}
	async emptyTrash(): Promise<number> {
		return (await this.post<{ deleted: number }>('/api/trash/empty', {})).deleted;
	}
	usage(): Promise<Usage> {
		return this.json('/api/usage');
	}
	imageUrl(sha: string): string {
		return `${this.base}/api/images/${sha}`;
	}

	/** Saves a run, uploading the original only if the server does not have it. Returns the run (200 = already saved). */
	async saveRun(r: {
		settings: object;
		seed: number;
		engineVersion: string;
		durationMs: number;
		original: Blob;
		result: Blob;
		thumb: Blob;
		w: number;
		h: number;
		title?: string | null;
	}): Promise<ApiRun> {
		const hash = async (b: Blob) => sha256Hex(await b.arrayBuffer());
		const [os, rs, ts] = await Promise.all([hash(r.original), hash(r.result), hash(r.thumb)]);
		const { exists } = await this.post<{ exists: boolean }>('/api/images/check', { sha256: os });
		const meta = {
			settings: r.settings,
			seed: r.seed,
			engine_version: r.engineVersion,
			duration_ms: Math.round(r.durationMs),
			title: r.title ?? null,
			original: { sha256: os, mime: r.original.type, w: r.w, h: r.h },
			result: { sha256: rs, mime: r.result.type, w: r.w, h: r.h },
			thumb: { sha256: ts, mime: r.thumb.type, w: 0, h: 0 }
		};
		const form = new FormData();
		form.set('meta', JSON.stringify(meta));
		if (!exists) form.set('original', r.original, 'original');
		form.set('result', r.result, 'result');
		form.set('thumb', r.thumb, 'thumb');
		return this.json('/api/runs', { method: 'POST', body: form });
	}
}
