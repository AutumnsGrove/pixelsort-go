// The real UpdateClient: five endpoints of the gallery server (docs/api.md). The page never names an image: `start` can
// only ask for "latest". A network error is normal while the container is being replaced, so it is thrown for the caller
// to treat as "the server is restarting", not reported as a failure.
import type { Available, UpdateClient, UpdateResult, VersionInfo } from '../updater';

type Fetch = typeof fetch;

export class HttpUpdateClient implements UpdateClient {
	constructor(
		private readonly f: Fetch = (...a) => fetch(...a),
		private readonly base = ''
	) {}

	private async json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
		const res = await this.f(this.base + path, { cache: 'no-store', ...init });
		const body = (await res.json().catch(() => null)) as T | null;
		return { status: res.status, body };
	}

	async getVersion(): Promise<VersionInfo> {
		const { status, body } = await this.json<{
			version: string;
			deployment: string;
			updater?: string;
			heartbeat_age_s?: number;
		}>('/api/version');
		if (status !== 200 || !body) throw new Error(`version: status ${status}`);
		return {
			version: body.version,
			deployment: body.deployment,
			updater: body.updater ?? 'not installed',
			heartbeatAgeMs: typeof body.heartbeat_age_s === 'number' ? body.heartbeat_age_s * 1000 : null
		};
	}

	async getAvailable(): Promise<{ available: Available | null; check_pending: boolean }> {
		const { status, body } = await this.json<{ available: Available | null; check_pending: boolean }>(
			'/api/update/available'
		);
		if (status === 404) return { available: null, check_pending: false }; // updates are not set up on this server
		if (status !== 200 || !body) throw new Error(`available: status ${status}`);
		return { available: body.available ?? null, check_pending: !!body.check_pending };
	}

	async getStatus(): Promise<{ pending: boolean; result: UpdateResult | null }> {
		const { status, body } = await this.json<{ pending: boolean; result: UpdateResult | null }>('/api/update/status');
		if (status === 404) return { pending: false, result: null };
		if (status !== 200 || !body) throw new Error(`status: status ${status}`);
		return { pending: !!body.pending, result: body.result ?? null };
	}

	async check(): Promise<{ ok: true }> {
		const { status } = await this.json('/api/update/check', { method: 'POST' });
		if (status !== 202 && status !== 200) throw new Error(`check: status ${status}`);
		return { ok: true };
	}

	async start(body: string): Promise<{ ok: true }> {
		if (body !== 'latest') throw new Error('The app only ever asks for the latest version.');
		const { status, body: reply } = await this.json<{ error?: { message?: string } }>('/api/update/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ target: 'latest' })
		});
		if (status === 409) throw new Error('An upload is still running. Try again in a moment.');
		if (status !== 202 && status !== 200) throw new Error(reply?.error?.message ?? `start: status ${status}`);
		return { ok: true };
	}
}
