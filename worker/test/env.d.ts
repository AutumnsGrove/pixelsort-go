/// <reference path="../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
// Teaches `exports` and `env` from "cloudflare:workers" about this Worker.
declare namespace Cloudflare {
	interface Exports {
		default: { fetch(request: Request): Promise<Response> };
	}
	interface Env {
		ALBUMS: R2Bucket;
		SHARED_SECRET: string;
	}
}
