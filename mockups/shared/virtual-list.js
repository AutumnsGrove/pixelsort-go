/*
 * Virtual list — render only the rows near the viewport, so 2,000 runs cost the same as 20.
 *
 * Pure part (tested in Node): layout(rows) -> prefix offsets; range(offsets, scrollTop, viewH, overscanPx) -> [start, end).
 * DOM part: mount({ scroller, host, renderRow }) keeps rows absolutely positioned inside `host`, whose height is the
 * full list height, so the scrollbar and "scroll to row" behave as if every row existed.
 *
 *   rows: [{ h: 126, ...anything }]     renderRow(row, i) -> Element
 *   scroller: an element with overflow:auto, or `window` for page scroll
 */
(function (root) {
  "use strict";

  /** offsets[i] = top of row i; offsets[n] = total height. */
  function layout(rows) {
    const off = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) off[i + 1] = off[i] + rows[i].h;
    return off;
  }

  /** First row whose bottom is below y (binary search over the offsets). */
  function rowAt(off, y) {
    let lo = 0, hi = off.length - 2;
    if (hi < 0) return 0;
    if (y <= 0) return 0;
    if (y >= off[off.length - 1]) return hi;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (off[mid + 1] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Rows [start, end) that intersect the viewport, widened by overscan on both sides. */
  function range(off, scrollTop, viewH, overscan) {
    const n = off.length - 1; if (n <= 0) return [0, 0];
    const top = Math.max(0, scrollTop - (overscan || 0)), bot = scrollTop + viewH + (overscan || 0);
    if (bot <= 0 || top >= off[n]) return [0, 0];
    const start = rowAt(off, top);
    let end = rowAt(off, Math.min(bot, off[n] - 1e-6)) + 1;
    return [start, Math.min(n, end)];
  }

  function mount(o) {
    const scroller = o.scroller || window, host = o.host, over = o.overscan == null ? 400 : o.overscan, isWin = scroller === window;
    let rows = [], off = new Float64Array(1), live = new Map(), q = 0;
    host.style.position = "relative";
    function viewport() {
      const hr = host.getBoundingClientRect();
      if (isWin) return { top: -hr.top, h: window.innerHeight };
      const sr = scroller.getBoundingClientRect(); return { top: sr.top - hr.top, h: scroller.clientHeight };
    }
    function update() {
      q = 0; const v = viewport(), r = range(off, v.top, v.h, over);
      live.forEach((el, i) => { if (i < r[0] || i >= r[1]) { el.remove(); live.delete(i); } });
      for (let i = r[0]; i < r[1]; i++) {
        if (live.has(i)) continue;
        const el = o.renderRow(rows[i], i); if (!el) continue;
        el.style.position = "absolute"; el.style.top = off[i] + "px"; el.style.left = "0"; el.style.right = "0"; el.style.height = rows[i].h + "px";
        host.appendChild(el); live.set(i, el);
      }
      if (o.onRange) o.onRange(r, v);
    }
    const sched = () => { if (!q) q = requestAnimationFrame(update); };
    scroller.addEventListener("scroll", sched, { passive: true }); window.addEventListener("resize", sched);
    function setRows(r) {
      rows = r; off = layout(r); host.style.height = off[off.length - 1] + "px";
      live.forEach((el) => el.remove()); live.clear(); update();
    }
    /* the rows' content changed (a selection, a star) but not their number or heights: redraw what is on screen */
    function rerender() { live.forEach((el) => el.remove()); live.clear(); update(); }
    function offsetOf(i) { return off[Math.max(0, Math.min(rows.length, i))]; }
    /* Short hops glide; a far jump lands at once (a smooth scroll over 200,000 px is three seconds of blur). */
    function scrollToRow(i, smooth) {
      const y = offsetOf(i), hr = host.getBoundingClientRect(), v = viewport();
      const far = Math.abs(y - v.top) > v.h * 4, behavior = smooth && !far ? "smooth" : "auto";
      if (isWin) window.scrollTo({ top: window.scrollY + hr.top + y - 100, behavior });
      else { const sr = scroller.getBoundingClientRect(); scroller.scrollTo({ top: scroller.scrollTop + (hr.top - sr.top) + y - 8, behavior }); }
    }
    /** the row at the top of the viewport (for the jump rail's "you are here") */
    function topRow() { const v = viewport(); return rowAt(off, Math.max(0, v.top) + 1); }
    return { setRows, rerender, update, scrollToRow, topRow, offsetOf, count: () => live.size, destroy() { scroller.removeEventListener("scroll", sched); window.removeEventListener("resize", sched); live.forEach((el) => el.remove()); live.clear(); } };
  }

  const api = { layout, range, rowAt, mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.VirtualList = api;
})(typeof self !== "undefined" ? self : this);
