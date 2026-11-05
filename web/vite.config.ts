import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The engine runs in a worker; cross-origin isolation keeps a future worker pool (SharedArrayBuffer) possible
// without a deployment change (decision B3).
const isolation = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

// server.headers / preview.headers do not reach SvelteKit's own handlers, so set them in a middleware that runs first.
const isolate: Plugin = {
	name: 'cross-origin-isolation',
	configureServer: (server) => void server.middlewares.use(setHeaders),
	configurePreviewServer: (server) => void server.middlewares.use(setHeaders)
};
function setHeaders(_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void): void {
	for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
	next();
}

export default defineConfig({
	plugins: [isolate, sveltekit({ adapter: adapter({ fallback: 'index.html' }) })],
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
