/*
 * Runs data for the mockups — a deterministic pile of fake runs, and the pure helpers that turn a pile into rows
 * (date headers + chunks of cards) for the virtual list. The real app gets runs from GET /api/runs with paging.
 *
 *   RunsData.make(2000)                        newest first
 *   RunsData.filter(runs, { q, starred })      search name + recipe words, optionally only starred
 *   RunsData.rows(runs, { cols, headH, rowH, sort })   -> rows for VirtualList, plus a jump index
 *
 * "Today" is fixed at 2026-11-02 so the mockups look the same every day.
 */
(function (root) {
  "use strict";
  const TODAY = Date.UTC(2026, 10, 2), DAY = 864e5;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const NAMES = ["Ridge", "Dusk", "Static", "Heat", "Curtain", "Embers", "Rain", "Kims", "Skyline", "Ash", "Glass", "Tide", "Dune", "Noise", "Fall", "Ember rain"];
  const MODES = ["random", "wave", "threshold", "edges", "ca"], KEYS = ["luma", "value", "intensity", "hue", "saturation", "red", "green", "blue"];

  function rng(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /** n runs, newest first. Recent days are busy; the tail thins out over ~18 months. */
  function make(n) {
    const r = rng(11), out = [];
    for (let i = 0; i < n; i++) {
      const mode = MODES[Math.floor(r() * MODES.length)], p = { mode, key: KEYS[Math.floor(r() * KEYS.length)], angle: Math.floor(r() * 360), seed: 1 + Math.floor(r() * 90), randomness: 5 + Math.floor(r() * 40) };
      if (mode === "random" || mode === "wave") p.length = 10 + Math.floor(r() * 150);
      if (mode === "threshold") { p.lo = 0.15 + r() * 0.3; p.hi = 0.55 + r() * 0.4; }
      if (mode === "ca") { p.rule = [26, 110, 154, 45, 106, 30][Math.floor(r() * 6)]; p.cell = 3 + Math.floor(r() * 6); }
      if (mode === "edges") p.edge = 14 + Math.floor(r() * 40);
      out.push({ id: i, name: NAMES[Math.floor(r() * NAMES.length)] + ", " + (mode === "ca" ? "cellular" : mode), p, mb: 14 + Math.round(r() * 140) / 10, age: Math.floor(Math.pow(i / Math.max(1, n), 1.6) * 540), starred: r() < 0.08, shared: r() < 0.12 });
    }
    return out;
  }

  const dateOf = (age) => new Date(TODAY - age * DAY);
  /** "Today", "Yesterday", "This week", "Last week", then "October 2026". */
  function groupLabel(age) {
    if (age <= 0) return "Today"; if (age === 1) return "Yesterday"; if (age <= 6) return "This week"; if (age <= 13) return "Last week";
    const d = dateOf(age); return MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  const agoText = (age) => age === 0 ? "today" : age === 1 ? "yesterday" : age < 30 ? age + " days ago" : Math.round(age / 30) + " mo ago";

  function filter(runs, o) {
    o = o || {}; const q = (o.q || "").trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    return runs.filter((r) => {
      if (o.starred && !r.starred) return false;
      if (!words.length) return true;
      const hay = (r.name + " " + r.p.mode + " " + r.p.key + " " + (r.p.angle != null ? r.p.angle + "°" : "") + (r.p.rule ? " rule " + r.p.rule : "")).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  /**
   * Rows for the virtual list. Date-sorted lists get a header row whenever the label changes; other sorts are flat.
   * Each card row holds up to `cols` runs. Returns { rows, jumps: [{label, row}] } — jumps are the header rows.
   */
  function rows(list, o) {
    o = o || {}; const cols = Math.max(1, o.cols || 1), headH = o.headH || 30, rowH = o.rowH || 120, dated = o.sort !== "big";
    const out = [], jumps = []; let cur = null, buf = [];
    const flush = () => { while (buf.length) out.push({ type: "cards", h: rowH, items: buf.splice(0, cols) }); };
    for (const r of list) {
      if (dated) { const lab = groupLabel(r.age); if (lab !== cur) { flush(); cur = lab; jumps.push({ label: lab, row: out.length }); out.push({ type: "head", h: headH, label: lab }); } }
      buf.push(r);
      if (buf.length === cols) flush();
    }
    flush(); return { rows: out, jumps };
  }

  const api = { make, groupLabel, agoText, filter, rows, TODAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RunsData = api;
})(typeof self !== "undefined" ? self : this);
