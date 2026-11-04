// Measures what a sort costs and which way of getting pixels out of Go is faster, in headless Chromium.
// Usage: pnpm build && node web/scripts/bench.mjs   (needs `make wasm` first; writes docs/perf.md)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const RUNS = Number(process.env.RUNS ?? 10);
const server = spawn('pnpm', ['--dir', 'web', 'preview', '--port', '4174'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
let exitCode = 0;
try {
	const browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
		args: ['--no-sandbox']
	});
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:4174/lab/bench');
	await page.waitForFunction(() => typeof window.bench === 'function', null, { timeout: 30000 });
	const rows = [];
	for (const mp of [1, 2, 8, 24]) {
		const row = await page.evaluate(([m, n]) => window.bench(m, n), [mp, RUNS]);
		rows.push(row);
		console.log(JSON.stringify(row));
		if (!row.viewOk || !row.same) exitCode = 1;
	}
	const version = browser.version();
	await browser.close();
	const f = (n) => n.toFixed(1);
	const r8 = rows.find((r) => Math.round(r.mp) === 8) ?? rows[2];
	const viewWins = r8.view <= r8.copy * 0.8 && rows.every((r) => r.viewOk);
	const md = `# Performance

Measured by \`web/scripts/bench.mjs\` (headless Chromium, engine on the main thread, ${RUNS} runs, medians in ms).

- Machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.cpus().length} threads, ${os.platform()} ${os.release()}
- Browser: Chromium ${version}
- Date: ${new Date().toISOString().slice(0, 10)}

| MP | prepare | sort | copy out + draw | view + draw | setImage in | worst sort |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${f(r.mp)} | ${f(r.prepare)} | ${f(r.sort)} | ${f(r.copy)} | ${f(r.view)} | ${f(r.send)} | ${f(r.worst.sort)} |`).join('\n')}

**Decision rule:** use the zero-copy view if it is at least 20% faster than copy at 8 MP and the view-length check never
failed; otherwise copy. At 8 MP copy is ${f(r8.copy)} ms and view is ${f(r8.view)} ms, so the choice is
**${viewWins ? 'view' : 'copy'}**. Both give identical pixels (checked every run).
Both strategies stay in \`worker.ts\`; \`/lab?transfer=copy|view\` picks one so this can be re-measured. Phone numbers are
[HUMAN], optional: run \`/lab/bench\` on a phone and paste the table here.
`;
	writeFileSync('docs/perf.md', md);
	console.log(md);
} finally {
	server.kill();
}
process.exit(exitCode);
