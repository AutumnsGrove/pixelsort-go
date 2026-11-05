import { deleteAlbum } from './albums';
import { isAlbumId, isIndex } from './validate';
import { csp, gonePage, newNonce, viewerPage, type Manifest } from './viewer';
// The viewer page and the public file routes (GET /a/...).

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function html(status: number, body: string, nonce: string, cache = 'no-store'): Response {
	return new Response(body, {
		status,
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp(nonce), 'Cache-Control': cache, ...SECURITY }
	});
}

/** The page shown for a revoked, expired or never-existing link: always the same, always 404. */
const gone = (): Response => html(404, gonePage(), newNonce());

async function loadManifest(env: { ALBUMS: R2Bucket }, id: string, ctx: ExecutionContext): Promise<Manifest | null> {
	const obj = await env.ALBUMS.get(`albums/${id}/manifest.json`);
	if (!obj) return null;
	let m: Manifest;
	try {
		m = (await obj.json()) as Manifest;
	} catch {
		return null;
	}
	if (m.expires !== null && m.expires * 1000 < Date.now()) {
		ctx.waitUntil(deleteAlbum(env.ALBUMS, id));
		return null;
	}
	return m;
}

/** The public routes under /a/. Returns null when the path is not one of them. */
export async function handlePublic(request: Request, env: { ALBUMS: R2Bucket }, ctx: ExecutionContext, path: string): Promise<Response | null> {
	const parts = path.split('/'); // ['', 'a', id, ...]
	if (parts[1] !== 'a') return null;
	if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
	const id = parts[2] ?? '';
	if (!isAlbumId(id)) return gone();
	const rest = parts.slice(3);

	const manifest = await loadManifest(env, id, ctx);
	if (!manifest) return gone();

	if (rest.length === 0) {
		const nonce = newNonce();
		return html(200, viewerPage(id, manifest, nonce, Date.now() / 1000), nonce, 'no-cache');
	}

	const cors = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', ...SECURITY };
	if (rest.length === 1 && rest[0] === 'manifest.json') {
		return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...cors } });
	}

	let key: string | null = null;
	if (rest.length === 1 && isIndex(rest[0])) key = `albums/${id}/images/${rest[0]}`;
	else if (rest.length === 2 && isIndex(rest[0]) && rest[1] === 'thumb') key = `albums/${id}/thumbs/${rest[0]}`;
	if (!key) return gone();

	const wantsRange = request.headers.has('Range');
	const obj = await env.ALBUMS.get(key, wantsRange ? { range: request.headers } : undefined);
	if (!obj) return gone();
	const headers = new Headers({
		'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
		'Cache-Control': 'public, max-age=3600',
		'Accept-Ranges': 'bytes',
		ETag: obj.httpEtag,
		...cors
	});
	let status = 200;
	if (wantsRange && obj.range && 'offset' in obj.range && obj.range.offset !== undefined) {
		const offset = obj.range.offset;
		const length = obj.range.length ?? obj.size - offset;
		headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
		headers.set('Content-Length', String(length));
		status = 206;
	} else {
		headers.set('Content-Length', String(obj.size));
	}
	return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}
