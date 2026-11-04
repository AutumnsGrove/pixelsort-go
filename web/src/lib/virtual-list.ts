// Virtual list maths: render only the rows near the viewport, so 2,000 runs cost the same as 20. Port of the pure part
// of mockups/shared/virtual-list.js; the component that renders the window is a Svelte component.

/** offsets[i] = top of row i; offsets[n] = total height. */
export function layout(rows: { h: number }[]): Float64Array {
	const off = new Float64Array(rows.length + 1);
	for (let i = 0; i < rows.length; i++) off[i + 1] = (off[i] ?? 0) + (rows[i]?.h ?? 0);
	return off;
}

/** First row whose bottom is below y (binary search over the offsets). */
export function rowAt(off: Float64Array, y: number): number {
	let hi = off.length - 2;
	if (hi < 0 || y <= 0) return 0;
	if (y >= (off[off.length - 1] ?? 0)) return hi;
	let lo = 0;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((off[mid + 1] ?? 0) <= y) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Rows [start, end) that intersect the viewport, widened by `overscan` pixels on both sides. */
export function range(off: Float64Array, scrollTop: number, viewH: number, overscan = 0): [number, number] {
	const n = off.length - 1;
	if (n <= 0) return [0, 0];
	const total = off[n] ?? 0;
	const top = Math.max(0, scrollTop - overscan);
	const bot = scrollTop + viewH + overscan;
	if (bot <= 0 || top >= total) return [0, 0];
	const start = rowAt(off, top);
	const end = rowAt(off, Math.min(bot, total - 1e-6)) + 1;
	return [start, Math.min(n, end)];
}
