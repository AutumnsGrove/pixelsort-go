# Performance

Measured by `web/scripts/bench.mjs` (headless Chromium, engine on the main thread, 10 runs, medians in ms).

- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 threads, linux 6.18.44-fc-v236
- Browser: Chromium 153.0.8010.12
- Date: 2026-11-04

| MP | prepare | sort | copy out + draw | view + draw | setImage in | worst sort |
|---|---|---|---|---|---|---|
| 1.0 | 38.2 | 16.7 | 3.5 | 3.1 | 7.6 | 32.4 |
| 2.0 | 68.9 | 31.7 | 6.0 | 5.2 | 10.1 | 40.6 |
| 8.0 | 286.0 | 157.5 | 123.7 | 139.2 | 36.3 | 197.1 |
| 24.0 | 822.9 | 535.5 | 397.7 | 340.8 | 106.6 | 1070.8 |

**Decision rule:** use the zero-copy view if it is at least 20% faster than copy at 8 MP and the view-length check never
failed; otherwise copy. At 8 MP copy is 123.7 ms and view is 139.2 ms, so the choice is
**copy**. Both give identical pixels (checked every run).
Both strategies stay in `worker.ts`; `/lab?transfer=copy|view` picks one so this can be re-measured. Phone numbers are
[HUMAN], optional: run `/lab/bench` on a phone and paste the table here.
