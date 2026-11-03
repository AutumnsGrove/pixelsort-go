// Runs every mockup test in turn and reports a one-line verdict for each.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const tests = [
  ['engine-properties.mjs', 'sorting engine: bijection, permutation, sorted, stepper == instant'],
  ['region-properties.mjs', 'regions: coverage, frozen stay put, no cell crossed'],
  ['custom-shapes.mjs', 'custom SVG shapes + per-region cutting'],
  ['presets.mjs', 'presets: rolls stay in range, re-roll, edited tag, save and delete'],
  ['export.mjs', 'export: planner properties, banded progress, device warnings (Studio + phone)'],
  ['peek.mjs', 'what-can-move overlay: engine map agrees with sorting; Studio + phone'],
  ['mask-editor.mjs', 'mask shapes: drag, resize, rotate, hole, invert, snap (desktop)'],
  ['phone-mask.mjs', 'mask shapes on the phone sheet'],
  ['layout-scan.mjs', 'every screen x 4 window sizes: no overflow or collisions'],
];
let failed = 0;
for (const [file, what] of tests) {
  const r = spawnSync('node', [path.join(dir, file)], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(24)} ${what}`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').map((l) => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
