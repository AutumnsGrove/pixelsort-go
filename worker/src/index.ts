import { handleAlbums } from './albums';
import { verify } from './auth';
import { handlePublic } from './public';

export interface Env {
	ALBUMS: R2Bucket;
	SHARED_SECRET: string;
	MAX_FETCH_BYTES: string;
}

const json = (status: number, body: object) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const path = new URL(request.url).pathname;
		const pub = await handlePublic(request, env, ctx, path);
		if (pub) return pub;
		// Everything under /api and /fetch needs the potato's signature; nothing is served to anyone else.
		if (path.startsWith('/api/') || path === '/fetch') {
			const verdict = await verify(request, env.SHARED_SECRET, Math.floor(Date.now() / 1000));
			if (verdict !== 'ok') return json(401, { error: verdict });
			const res = await handleAlbums(request, env, path);
			if (res) return res;
			return json(404, { error: 'not_found' }); // /fetch arrives later
		}
		return new Response('not found', { status: 404 });
	},
	async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
		// the daily expiry sweep arrives with the album routes
	}
} satisfies ExportedHandler<Env>;
