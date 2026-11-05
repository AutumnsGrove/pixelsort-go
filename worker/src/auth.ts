export type Verdict = 'ok' | 'missing' | 'stale' | 'bad-signature' | 'bad-body';

const MAX_SKEW_S = 300;
const enc = new TextEncoder();

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The signing string both sides agree on (see docs/dev/phase-6b.md). */
export function signingString(method: string, path: string, timestamp: string, bodySha: string): string {
	return `PS1\n${method.toUpperCase()}\n${path}\n${timestamp}\n${bodySha}`;
}

export async function sign(
	secret: string,
	method: string,
	path: string,
	timestamp: string,
	bodySha: string
): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	return hex(await crypto.subtle.sign('HMAC', key, enc.encode(signingString(method, path, timestamp, bodySha))));
}

/** Compares in time that does not depend on where the strings first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
	const x = enc.encode(a);
	const y = enc.encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

/** Checks the three X-PS-* headers. The body hash header is trusted here; `verifiedBody` checks it against the bytes. */
export async function verify(request: Request, secret: string, nowSeconds: number): Promise<Verdict> {
	const ts = request.headers.get('X-PS-Timestamp');
	const sha = request.headers.get('X-PS-Content-SHA256');
	const sig = request.headers.get('X-PS-Signature');
	if (!ts || !sha || !sig) return 'missing';
	if (!/^\d{1,12}$/.test(ts)) return 'bad-signature';
	if (Math.abs(nowSeconds - Number(ts)) > MAX_SKEW_S) return 'stale';
	const url = new URL(request.url);
	const want = await sign(secret, request.method, url.pathname + url.search, ts, sha);
	return constantTimeEqual(want, sig) ? 'ok' : 'bad-signature';
}

/** Streams the body through and errors at the end if its SHA-256 is not the declared one. */
export function verifiedBody(body: ReadableStream<Uint8Array>, expectedSha: string): ReadableStream<Uint8Array> {
	const digest = new crypto.DigestStream('SHA-256');
	const writer = digest.getWriter();
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			async transform(chunk, controller) {
				await writer.write(chunk);
				controller.enqueue(chunk);
			},
			async flush(controller) {
				await writer.close();
				if (hex(await digest.digest) !== expectedSha) controller.error(new Error('hash_mismatch'));
			}
		})
	);
}
