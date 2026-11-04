import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// The engine runs in a worker; cross-origin isolation keeps a future worker pool (SharedArrayBuffer) possible
// without a deployment change (decision B3).
const isolation = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter({ fallback: 'index.html' }) })],
	server: { headers: isolation },
	preview: { headers: isolation },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
