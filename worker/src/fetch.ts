// GET /fetch?url=...  The relay that loads a picture from the public internet on the app's behalf, with strict guards.

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'pixelsort-go/1';

type Code = 'link-blocked' | 'link-not-image' | 'link-too-large' | 'link-timeout';
const STATUS: Record<Code, number> = { 'link-blocked': 502, 'link-not-image': 415, 'link-too-large': 413, 'link-timeout': 504 };
const MESSAGE: Record<Code, string> = {
	'link-blocked': 'The site would not let the relay fetch that.',
	'link-not-image': 'That address is not a picture.',
	'link-too-large': 'That picture is bigger than the relay allows.',
	'link-timeout': 'The site took too long to answer.'
};

class Fail extends Error {
	constructor(readonly code: Code) {
		super(code);
	}
}

export const failure = (code: Code): Response =>
	new Response(JSON.stringify({ error: { code, message: MESSAGE[code] } }), {
		status: STATUS[code],
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});

function isPrivateIPv4(h: string): boolean {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIPv6(h: string): boolean {
	const x = h.replace(/^\[|\]$/g, '').toLowerCase();
	if (!x.includes(':')) return false;
	if (x === '::1' || x === '::') return true;
	if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return true; // unique-local, link-local
	const mapped = /^::ffff:(.+)$/.exec(x); // IPv4-mapped
	if (mapped) return mapped[1].includes('.') ? isPrivateIPv4(mapped[1]) : true;
	return false;
}

/** Rule 1: returns the parsed URL, or throws Fail('link-blocked'). */
export function checkUrl(raw: string): URL {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new Fail('link-blocked');
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Fail('link-blocked');
	if (u.username || u.password) throw new Fail('link-blocked');
	if (u.port !== '' && u.port !== '80' && u.port !== '443') throw new Fail('link-blocked');
	const host = u.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Fail('link-blocked');
	if (isPrivateIPv4(host) || isPrivateIPv6(host)) throw new Fail('link-blocked');
	return u;
}

/** Looks at the first bytes and says what picture format they are, or null. */
export function sniff(b: Uint8Array): string | null {
	const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
	if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
	if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) return 'image/avif';
	return null;
}

/** Reads the first n bytes of a stream and gives back the stream with them put back, counting and capping the total. */
async function peekAndLimit(body: ReadableStream<Uint8Array>, max: number): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> }> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let have = 0;
	while (have < 16) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		have += value.length;
	}
	const head = new Uint8Array(have);
	let off = 0;
	for (const c of chunks) {
		head.set(c, off);
		off += c.length;
	}
	let total = 0;
	const queue = [...chunks];
	const rest = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = queue.shift();
			let chunk = next;
			if (!chunk) {
				const r = await reader.read();
				if (r.done) return controller.close();
				chunk = r.value;
			}
			total += chunk.length;
			if (total > max) {
				await reader.cancel();
				return controller.error(new Fail('link-too-large'));
			}
			controller.enqueue(chunk);
		},
		cancel: (reason) => reader.cancel(reason)
	});
	return { head: head.slice(0, 16), rest };
}

export async function handleFetch(request: Request, env: { MAX_FETCH_BYTES?: string }): Promise<Response> {
	const target = new URL(request.url).searchParams.get('url');
	if (!target) return failure('link-blocked');
	const max = Number(env.MAX_FETCH_BYTES) || 50 * 1024 * 1024;
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	try {
		let url = checkUrl(target);
		let res: Response | undefined;
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			// no cookies, no Authorization, a fixed polite User-Agent
			res = await fetch(url.toString(), { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
			if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
				if (hop === MAX_REDIRECTS) throw new Fail('link-blocked');
				url = checkUrl(new URL(res.headers.get('Location')!, url).toString());
				await res.body?.cancel();
				continue;
			}
			break;
		}
		if (!res) throw new Fail('link-blocked');
		if (res.status < 200 || res.status >= 300) {
			await res.body?.cancel();
			throw new Fail('link-blocked');
		}
		const declared = Number(res.headers.get('Content-Length'));
		if (declared > max) {
			await res.body?.cancel();
			throw new Fail('link-too-large');
		}
		const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
		if (!type.startsWith('image/') || !res.body) {
			await res.body?.cancel();
			throw new Fail('link-not-image');
		}
		const { head, rest } = await peekAndLimit(res.body, max);
		const sniffed = sniff(head);
		if (!sniffed) {
			await rest.cancel();
			throw new Fail('link-not-image');
		}
		// the timer keeps running on purpose: 15 s is the budget for the whole transfer, not just the headers
		return new Response(rest, {
			headers: { 'Content-Type': sniffed, 'X-Source-URL': url.toString(), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
		});
	} catch (e) {
		clearTimeout(timer);
		if (e instanceof Fail) return failure(e.code);
		if (ctl.signal.aborted) return failure('link-timeout');
		return failure('link-blocked'); // connection refused, DNS failure and the like
	}
}
