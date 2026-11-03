/*
 * Export planning — pure functions, no DOM. The Go engine's export planner should reproduce these.
 *
 * Memory model (PLAN.md §3, P3): a full-resolution export holds the decoded source and the output the whole
 * time (4 B/px each); the sorter's scratch (sort keys, line index, interval table) is about 9 B/px, but it is
 * only needed for the band being sorted. So `bands` shrinks the scratch, never the 8 B/px floor — which is
 * why a big enough picture cannot be exported on a small device at any band count, and the UI must say so.
 */
(function (root) {
  "use strict";

  const FLOOR_BPP = 8, SCRATCH_BPP = 9;
  const BAND_STEPS = [1, 2, 4, 8, 16, 32, 64];
  // Deliberately conservative budgets: what one browser tab can reliably hold, not what the device has.
  const DEVICES = {
    desktop: { name: "Desktop", budgetMB: 2000 },
    phone: { name: "Phone", budgetMB: 300 },
  };
  const FORMATS = {
    png: { name: "PNG", lossy: false, ext: "png", note: "Lossless. Biggest files; exact pixels." },
    jpeg: { name: "JPEG", lossy: true, ext: "jpg", note: "Small and universal. No transparency." },
    webp: { name: "WebP", lossy: true, ext: "webp", note: "Smaller than JPEG at the same look." },
  };
  const SCALES = [1, 0.75, 0.5, 0.25];

  /** Peak memory in MB for `px` pixels exported in `bands` bands. */
  const memoryMB = (px, bands) => (px * (FLOOR_BPP + SCRATCH_BPP / bands)) / 1e6;

  /** Choose the fewest bands that fit the budget. verdict: ok (one pass) | banded | toolarge. */
  function plan(w, h, device) {
    const dev = DEVICES[device] || DEVICES.desktop, px = w * h;
    for (const n of BAND_STEPS) {
      const mb = memoryMB(px, n);
      if (mb <= dev.budgetMB) return { verdict: n === 1 ? "ok" : "banded", bands: n, memMB: mb, budgetMB: dev.budgetMB, px };
    }
    const maxPx = (dev.budgetMB * 1e6) / (FLOOR_BPP + SCRATCH_BPP / BAND_STEPS[BAND_STEPS.length - 1]);
    return { verdict: "toolarge", bands: BAND_STEPS[BAND_STEPS.length - 1], memMB: memoryMB(px, 64), budgetMB: dev.budgetMB, px, maxPx };
  }

  /** The largest scale in SCALES (by *linear* factor) that fits, or null. */
  function suggestScale(w, h, device) {
    for (const s of SCALES) if (plan(Math.round(w * s), Math.round(h * s), device).verdict !== "toolarge") return s;
    return null;
  }

  /** Rough file size. PNG ~2.2 B/px on a sorted photo; JPEG scales with quality; WebP ~0.65x JPEG. */
  function estimateBytes(format, quality, px) {
    if (format === "png") return px * 2.2;
    const jpeg = px * (0.15 + 0.0085 * quality);
    return format === "webp" ? jpeg * 0.65 : jpeg;
  }
  function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
    if (b >= 1e6) return (b / 1e6).toFixed(b >= 1e8 ? 0 : 1) + " MB";
    return Math.max(1, Math.round(b / 1e3)) + " KB";
  }
  const fmtMP = (px) => (px / 1e6).toFixed(px >= 1e7 ? 0 : 1) + " MP";

  /** Safe filename: name-recipe-seed.ext */
  function filename(name, recipe, format, tag) {
    const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const nm = slug(name), rc = slug(recipe);   // a name that already says the recipe ("Ridge, threshold") does not repeat it
    return [nm || "pixelsort", rc && nm.indexOf(rc) < 0 ? rc : "", slug(tag)].filter(Boolean).join("-") + "." + (FORMATS[format] || FORMATS.png).ext;
  }

  /** Line ranges for each band over `lines` scanlines (for the progress text). Covers 0..lines exactly. */
  function bandRanges(lines, bands) {
    const out = []; for (let i = 0; i < bands; i++) out.push([Math.floor((i * lines) / bands), Math.floor(((i + 1) * lines) / bands)]);
    return out;
  }

  const api = { DEVICES, FORMATS, SCALES, BAND_STEPS, memoryMB, plan, suggestScale, estimateBytes, fmtBytes, fmtMP, filename, bandRanges };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ExportModel = api;
})(typeof self !== "undefined" ? self : this);
