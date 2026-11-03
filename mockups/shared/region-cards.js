/*
 * Region cards — what each *kind* of shape does. One component for Studio's Pro panel and the phone's Shapes tab,
 * so the two can never drift apart. Each card folds open to: frozen, own direction, own sort key + order, own
 * animation algorithm, and a full own-cutting recipe (mode, length, band, edge, rule, cell, unsorted %).
 *
 *   const rc = RegionCards.create({ el, colors, pattern: () => 'checker', K: () => 2,
 *                                    onChange(kind) {...} });
 *   rc.classes            state, keyed by class id (0 = the gaps between shapes)
 *   rc.toDefs(K)          what PixelDemo.setRegions() wants as `defs`
 *   rc.render(counts)     rebuild the cards ({classId: shapeCount})
 *
 * onChange kinds:  'structure' (re-apply, re-render, replay) · 'value' (re-apply, replay; do not re-render, so a
 * focused number field survives) · 'live' (a slider is moving: instant preview only).
 * Pure parts (newClass, summary, toDefs) work without a DOM and are tested directly.
 */
(function (root) {
  "use strict";
  const KEYS = ["luma", "value", "intensity", "hue", "saturation", "red", "green", "blue"];
  const MODES = ["random", "wave", "threshold", "edges", "ca", "none"];
  const MODE_LABEL = { random: "random", wave: "wave", threshold: "threshold", edges: "edges", ca: "cellular", none: "none" };
  const RULES = [26, 110, 154, 45, 106, 30];
  const ALGOS = [["", "same as global"], ["oddeven", "odd-even"], ["insertion", "insertion"], ["reveal", "reveal"]];
  const ALGO_LABEL = { oddeven: "odd-even", insertion: "insertion", reveal: "reveal" };
  const FMT = { length: (v) => v + " px", lo: (v) => (+v).toFixed(2), hi: (v) => (+v).toFixed(2), edge: (v) => v, cell: (v) => v + " px", randomness: (v) => v + " %" };

  const newClass = (name, o) => Object.assign({ name, frozen: false, angleOn: false, angle: 0, key: "", rev: "", algo: "", cutOn: false, mode: "random",
    length: 40, lo: 0.2, hi: 0.82, edge: 26, rule: 110, cell: 4, randomness: 10, open: false }, o || {});
  const defaults = () => ({ 0: newClass("Between shapes", { frozen: true }), 1: newClass("Kind A"), 2: newClass("Kind B", { angleOn: true, angle: 90 }), 3: newClass("Kind C", { angleOn: true, angle: 45, key: "hue" }) });

  function detail(x) {
    if (!x.cutOn) return "";
    if (x.mode === "random" || x.mode === "wave") return " " + x.length;
    if (x.mode === "threshold") return " " + x.lo.toFixed(2) + "–" + x.hi.toFixed(2);
    if (x.mode === "ca") return " " + x.rule;
    if (x.mode === "edges") return " " + x.edge;
    return "";
  }
  /** One line for the folded card, e.g. "90° · hue ↓ · insertion · cellular 110". */
  function summary(x) {
    if (x.frozen) return "frozen — never moves";
    const p = [];
    if (x.angleOn) p.push(x.angle + "°");
    if (x.key || x.rev) p.push((x.key || "global key") + (x.rev === "desc" ? " ↓" : x.rev === "asc" ? " ↑" : ""));
    if (x.algo) p.push(ALGO_LABEL[x.algo]);
    if (x.cutOn) p.push(MODE_LABEL[x.mode] + detail(x));
    return p.length ? p.join(" · ") : "inherits everything";
  }
  /** null = "inherit the global setting"; the engine reads these per class. */
  function toDefs(classes, K) {
    const defs = {};
    for (let c = 0; c <= K; c++) {
      const x = classes[c], cut = x.cutOn;
      defs[c] = { frozen: !!x.frozen, angle: x.angleOn ? x.angle : null, key: x.key || null, reverse: x.rev === "desc" ? true : x.rev === "asc" ? false : null, algo: x.algo || null,
        mode: cut ? x.mode : null, length: cut ? x.length : null, lo: cut ? x.lo : null, hi: cut ? x.hi : null, edge: cut ? x.edge : null, rule: cut ? x.rule : null, cell: cut ? x.cell : null, randomness: cut ? x.randomness : null };
    }
    return defs;
  }

  const sw = (f, on) => '<div class="sw' + (on ? " on" : "") + '" data-f="' + f + '" role="switch" aria-checked="' + !!on + '" tabindex="0"></div>';
  const rng = (f, label, min, max, step, val) => '<div class="rrow"><label><span>' + label + "</span><em>" + FMT[f](val) + '</em></label><input type="range" data-f="' + f + '" aria-label="' + label + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + val + '"></div>';
  const chipRow = (f, list, cur) => '<div class="mini" data-f="' + f + '">' + list.map((o) => '<button data-v="' + o[0] + '" class="' + (String(cur) === String(o[0]) ? "on" : "") + '">' + o[1] + "</button>").join("") + "</div>";

  function cutBody(x) {
    let h = chipRow("mode", MODES.map((m) => [m, MODE_LABEL[m]]), x.mode);
    if (x.mode === "random" || x.mode === "wave") h += rng("length", "Run length", 6, 200, 1, x.length);
    if (x.mode === "threshold") h += rng("lo", "Sort from", 0, 1, 0.01, x.lo) + rng("hi", "Sort up to", 0, 1, 0.01, x.hi);
    if (x.mode === "edges") h += rng("edge", "Edge sensitivity", 6, 90, 1, x.edge);
    if (x.mode === "ca") h += '<div class="crow tight"><span>Rule</span><div class="rt"><input class="num" type="number" min="0" max="255" data-f="rule" aria-label="Rule" value="' + x.rule + '"></div></div>' + chipRow("rulepick", RULES.map((r) => [r, r]), x.rule) + rng("cell", "Cell size", 2, 14, 1, x.cell);
    if (x.mode !== "none") h += rng("randomness", "Leave unsorted", 0, 100, 1, x.randomness);
    return '<div class="cutbox">' + h + "</div>";
  }

  function cardHtml(o, c, n) {
    const x = o.classes[c], col = o.colors[c], title = o.pattern() === "all" && c === 1 ? "Every shape" : x.name;
    return '<div class="cls' + (x.open ? " open" : "") + '" data-c="' + c + '"><div class="chead" data-head role="button" tabindex="0" aria-expanded="' + !!x.open + '"><i style="background:rgb(' + col + ')"></i><div class="ctitle"><b>' + title + '</b><small class="csum">' + summary(x) + '</small></div><span class="cnt">' + (c === 0 ? "the gaps" : (n[c] || 0) + " shapes") + '</span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>' +
      '<div class="cbody">' +
      '<div class="crow"><span>Frozen — don’t sort</span>' + sw("frozen", x.frozen) + "</div>" +
      '<div class="crow"><span>Own direction</span><div class="rt"><input class="num" type="number" min="0" max="359" data-f="angle" aria-label="Direction" value="' + x.angle + '"' + (x.angleOn ? "" : " disabled") + ">" + sw("angleOn", x.angleOn) + "</div></div>" +
      '<div class="crow"><span>Own sort key</span><div class="rt"><select class="field" data-f="key" aria-label="Sort key"><option value="">same as global</option>' + KEYS.map((k) => "<option" + (x.key === k ? " selected" : "") + ">" + k + "</option>").join("") + "</select></div></div>" +
      chipRow("rev", [["", "either way"], ["asc", "↑ ascending"], ["desc", "↓ descending"]], x.rev) +
      '<div class="crow"><span>Watch this kind as</span></div>' + chipRow("algo", ALGOS, x.algo) +
      '<div class="crow"><span>Own cutting</span>' + sw("cutOn", x.cutOn) + "</div>" + (x.cutOn ? cutBody(x) : "") +
      "</div></div>";
  }

  function create(opts) {
    const o = { el: opts.el, colors: opts.colors, pattern: opts.pattern || (() => "checker"), K: opts.K || (() => 2), classes: defaults(), counts: {} };
    const fire = (k) => opts.onChange && opts.onChange(k);
    const cardOf = (el) => { const card = el.closest && el.closest(".cls"); return card ? { card, c: +card.dataset.c } : null; };
    const refresh = (card, c) => { const e = card.querySelector(".csum"); if (e) e.textContent = summary(o.classes[c]); };
    function render(counts) {
      if (counts) o.counts = counts;
      let h = ""; for (let c = 0; c <= o.K(); c++) h += cardHtml(o, c, o.counts); o.el.innerHTML = h;
    }
    function toggle(k, x) { x.open = !x.open; k.card.classList.toggle("open", x.open); const hd = k.card.querySelector("[data-head]"); if (hd) hd.setAttribute("aria-expanded", x.open); }
    o.el.addEventListener("click", (e) => {
      const k = cardOf(e.target); if (!k) return; const x = o.classes[k.c];
      const swEl = e.target.closest(".sw");
      if (swEl) { const f = swEl.dataset.f; x[f] = !x[f]; fire("structure"); return; }
      const chip = e.target.closest(".mini button");
      if (chip) { const grp = chip.parentNode.dataset.f, v = chip.dataset.v; if (grp === "mode") x.mode = v; else if (grp === "rev") x.rev = v; else if (grp === "algo") x.algo = v; else if (grp === "rulepick") x.rule = +v; fire("structure"); return; }
      if (e.target.closest("[data-head]")) toggle(k, x);
    });
    o.el.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const sEl = e.target.closest && e.target.closest(".sw"), hd = e.target.closest && e.target.closest("[data-head]");
      if (sEl || hd) { e.preventDefault(); e.target.click(); }
    });
    o.el.addEventListener("input", (e) => {
      const el = e.target, k = cardOf(el); if (!k || !el.dataset.f) return;
      const f = el.dataset.f, x = o.classes[k.c];
      if (el.type === "range") { x[f] = +el.value; const em = el.closest(".rrow").querySelector("em"); if (em) em.textContent = FMT[f](+el.value); refresh(k.card, k.c); fire("live"); }
      else if (f === "angle" || f === "rule") { const v = +el.value || 0; x[f] = f === "angle" ? ((v % 360) + 360) % 360 : Math.max(0, Math.min(255, v)); refresh(k.card, k.c); fire("value"); }
    });
    o.el.addEventListener("change", (e) => {
      const el = e.target, k = cardOf(el); if (!k) return; const f = el.dataset.f, x = o.classes[k.c];
      if (f === "key") { x.key = el.value; fire("structure"); } else if (el.type === "range") fire("value");
    });
    return { classes: o.classes, render, toDefs: (K) => toDefs(o.classes, K), summary };
  }

  const api = { KEYS, MODES, MODE_LABEL, RULES, ALGOS, newClass, defaults, summary, toDefs, create };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RegionCards = api;
})(typeof self !== "undefined" ? self : this);
