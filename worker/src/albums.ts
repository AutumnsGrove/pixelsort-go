import { isAlbumId, isImageType, isIndex, manifestError, MAX_MANIFEST_BYTES, MAX_OBJECT_BYTES } from './validate';

const json = (status: number, body: object) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HEX64 = /^[0-9a-f]{64}$/;

/** Deletes every object under albums/{id}/ (R2 lists at most 1000 keys per call, so this loops on the cursor). */
export async function deleteAlbum(bucket: R2Bucket, id: string): Promise<void> {
	const prefix = `albums/${id}/`;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

/** The signed album routes. The caller has already checked the signature. Returns null when the path is not an album route. */
export async function handleAlbums(request: Request, env: { ALBUMS: R2Bucket }, path: string): Promise<Response | null> {
	const parts = path.split('/'); // ['', 'api', 'albums', id, ...]
	if (parts[1] !== 'api' || parts[2] !== 'albums') return null;
	const id = parts[3] ?? '';
	if (!isAlbumId(id)) return json(400, { error: 'bad_album_id' });
	const rest = parts.slice(4);

	if (rest.length === 0) {
		if (request.method !== 'DELETE') return json(405, { error: 'method_not_allowed' });
		await deleteAlbum(env.ALBUMS, id);
		return new Response(null, { status: 204 });
	}
	if (request.method !== 'PUT') return json(405, { error: 'method_not_allowed' });
	const sha = request.headers.get('X-PS-Content-SHA256') ?? '';
	if (!HEX64.test(sha)) return json(400, { error: 'bad_hash' });

	if (rest.length === 1 && rest[0] === 'manifest.json') return putManifest(request, env.ALBUMS, id, sha);

	if (rest.length === 2 && (rest[0] === 'images' || rest[0] === 'thumbs')) {
		if (!isIndex(rest[1])) return json(400, { error: 'bad_index' });
		if (!isImageType(request.headers.get('Content-Type'))) return json(415, { error: 'unsupported_type' });
		const length = Number(request.headers.get('Content-Length'));
		if (!Number.isFinite(length) || request.headers.get('Content-Length') === null) return json(411, { error: 'length_required' });
		if (length > MAX_OBJECT_BYTES) return json(413, { error: 'too_large' });
		const contentType = request.headers.get('Content-Type')!.split(';')[0].trim();
		try {
			// R2 checks the declared SHA-256 itself and refuses the write if the bytes differ.
			await env.ALBUMS.put(`albums/${id}/${rest[0]}/${rest[1]}`, request.body, {
				sha256: sha,
				httpMetadata: { contentType }
			});
		} catch (e) {
			if (/checksum|did not match|10037/i.test(String(e))) return json(400, { error: 'hash_mismatch' });
			throw e;
		}
		return json(200, { ok: true });
	}
	return null;
}

async function putManifest(request: Request, bucket: R2Bucket, id: string, sha: string): Promise<Response> {
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length > MAX_MANIFEST_BYTES) return json(413, { error: 'too_large' });
	const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
	if (digest !== sha) return json(400, { error: 'hash_mismatch' });
	const err = manifestError(new TextDecoder().decode(bytes));
	if (err) return json(400, { error: 'bad_manifest', detail: err });
	await bucket.put(`albums/${id}/manifest.json`, bytes, { httpMetadata: { contentType: 'application/json' } });
	return json(200, { ok: true });
}
