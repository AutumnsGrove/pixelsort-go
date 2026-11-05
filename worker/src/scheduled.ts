import { deleteAlbum } from './albums';

export const SWEEP_BATCH = 200;
const STALE_UPLOAD_MS = 24 * 3600 * 1000;
const CURSOR_KEY = 'meta/sweep-cursor';

/** True when the album should go: past its expiry, or never finished uploading and now a day old. */
async function shouldDelete(bucket: R2Bucket, prefix: string, now: number): Promise<boolean> {
	const manifest = await bucket.get(`${prefix}manifest.json`);
	if (!manifest) {
		const objs = await bucket.list({ prefix, limit: 1000 });
		const newest = objs.objects.reduce((t, o) => Math.max(t, o.uploaded.getTime()), 0);
		return objs.objects.length === 0 || now - newest > STALE_UPLOAD_MS;
	}
	try {
		const m = (await manifest.json()) as { expires?: unknown };
		return typeof m.expires === 'number' && m.expires * 1000 < now;
	} catch (e) {
		console.warn(`sweep: skipping ${prefix}, unreadable manifest`, String(e));
		return false;
	}
}

/**
 * The daily expiry sweep. It looks at up to SWEEP_BATCH albums per run and remembers where it stopped,
 * so the next run carries on; after the last album it starts over from the beginning.
 */
export async function sweep(env: { ALBUMS: R2Bucket }, now = Date.now()): Promise<{ checked: number; deleted: number }> {
	const bucket = env.ALBUMS;
	const startAfter = (await (await bucket.get(CURSOR_KEY))?.text()) || undefined;
	let checked = 0;
	let deleted = 0;
	let last: string | undefined;
	let more = false;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: 'albums/', delimiter: '/', startAfter: cursor ? undefined : startAfter, cursor, limit: SWEEP_BATCH });
		for (const prefix of page.delimitedPrefixes) {
			if (checked >= SWEEP_BATCH) {
				more = true;
				break;
			}
			checked++;
			last = prefix;
			try {
				if (await shouldDelete(bucket, prefix, now)) {
					await deleteAlbum(bucket, prefix.slice('albums/'.length, -1));
					deleted++;
				}
			} catch (e) {
				console.warn(`sweep: ${prefix} failed`, String(e));
			}
		}
		cursor = !more && page.truncated ? page.cursor : undefined;
		if (page.truncated && checked >= SWEEP_BATCH) more = true;
	} while (cursor && !more);

	if (more && last) await bucket.put(CURSOR_KEY, last);
	else await bucket.delete(CURSOR_KEY);
	return { checked, deleted };
}
