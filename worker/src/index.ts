import { verify } from './auth';

export interface Env {
	ALBUMS: R2Bucket;
	SHARED_SECRET: string;
	MAX_FETCH_BYTES: string;
}

const json = (status: number, body: object) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const path = new URL(request.url).pathname;
		// Everything under /api and /fetch needs the potato's signature; nothing is served to anyone else.
		if (path.startsWith('/api/') || path === '/fetch') {
			const verdict = await verify(request, env.SHARED_SECRET, Math.floor(Date.now() / 1000));
			if (verdict !== 'ok') return json(401, { error: verdict });
			return json(404, { error: 'not_implemented' }); // the album and fetch routes arrive next
		}
		return new Response('not found', { status: 404 });
	},
	async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
		// the daily expiry sweep arrives with the album routes
	}
} satisfies ExportedHandler<Env>;
