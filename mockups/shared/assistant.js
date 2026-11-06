/*
 * Shape helper (issue #7), MOCKUP ONLY.
 *
 * What is real here: the pixel work. "Cut out this object" runs a real flood fill on the demo picture, traces the
 * outline, simplifies it and hands a real SVG to the shape library. The assistant's tools (describe_image, list_objects,
 * segment_from_point, simplify_outline, highlight, propose_shape) call the same functions.
 * What is faked: the model. A small scripted planner picks tool calls from keywords in the prompt, so the transcript,
 * timing, cancel, caps, consent and error states can be seen without any network or LLM.
 * Classic script; exposes window.Assistant. Pure helpers are separate from the UI so they could be ported/tested.
 */
(function (root) {
  "use strict";
  var KEY = "pixelsort.mock.assistant";
  var DEFAULTS = { on: false, cap: 8, used: 0, sim: "ok", model: "deepseek/deepseek-v4.1-flash-1017", noticed: false };

  function load() {
    var o = {}; try { o = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { o = {}; }
    var c = {}; for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    if (typeof o.on === "boolean") c.on = o.on;
    if (typeof o.noticed === "boolean") c.noticed = o.noticed;
    if ([4, 8, 16, 0].indexOf(o.cap) >= 0) c.cap = o.cap;
    if (typeof o.used === "number" && o.used >= 0) c.used = Math.min(o.used, 999);
    if (["ok", "offline", "novision", "nokey", "badshape", "slow"].indexOf(o.sim) >= 0) c.sim = o.sim;
    if (typeof o.model === "string") c.model = o.model.slice(0, 60);
    return c;
  }
  function save(patch) { var c = load(); for (var k in patch) c[k] = patch[k]; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} return c; }

  /* ---------------- pixel tools (pure; orig is a Uint32Array, ABGR little-endian like ImageData) ---------------- */
  function rgb(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; }
  function luma(v) { return 0.299 * (v & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * ((v >> 16) & 255); }
  function hex(c) { return "#" + c.map(function (n) { return ("0" + Math.round(n).toString(16)).slice(-2); }).join(""); }

  /** Grow a region from (x,y): 4-connected, every pixel within tol*2.2 (RGB distance) of the seed colour. */
  function segment(orig, w, h, x, y, tol, maxAreaPct) {
    x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y)));
    var seed = rgb(orig[y * w + x]), lim = tol * 2.2, lim2 = lim * lim, maxA = Math.round(w * h * (maxAreaPct || 60) / 100);
    var mask = new Uint8Array(w * h), q = new Int32Array(w * h), qh = 0, qt = 0, area = 0, sr = 0, sg = 0, sb = 0;
    var x0 = x, x1 = x, y0 = y, y1 = y, sx = 0, sy = 0, leaked = false;
    q[qt++] = y * w + x; mask[y * w + x] = 1;
    while (qh < qt) {
      var p = q[qh++], px = p % w, py = (p / w) | 0, v = orig[p];
      area++; var c = rgb(v); sr += c[0]; sg += c[1]; sb += c[2]; sx += px; sy += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (area > maxA) { leaked = true; break; }
      var nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
      for (var i = 0; i < 4; i++) {
        var n = nb[i]; if (n < 0 || mask[n]) continue;
        var cc = rgb(orig[n]), dr = cc[0] - seed[0], dg = cc[1] - seed[1], db = cc[2] - seed[2];
        if (dr * dr + dg * dg + db * db <= lim2) { mask[n] = 1; q[qt++] = n; }
      }
    }
    return { mask: mask, area: area, areaPct: area * 100 / (w * h), bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], leaked: leaked,
      mean: [sr / area, sg / area, sb / area], center: [sx / area, sy / area], seed: [x, y] };
  }

  /** Fill holes (background not reachable from the border) no bigger than maxHolePct of the frame. */
  function fillHoles(mask, w, h, maxHolePct) {
    var out = new Uint8Array(mask), seen = new Uint8Array(w * h), q = new Int32Array(w * h), qh = 0, qt = 0, i;
    function push(p) { if (!mask[p] && !seen[p]) { seen[p] = 1; q[qt++] = p; } }
    for (i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
    for (i = 0; i < h; i++) { push(i * w); push(i * w + w - 1); }
    while (qh < qt) { var p = q[qh++], px = p % w, py = (p / w) | 0; if (px > 0) push(p - 1); if (px < w - 1) push(p + 1); if (py > 0) push(p - w); if (py < h - 1) push(p + w); }
    var lim = w * h * (maxHolePct == null ? 0.3 : maxHolePct) / 100, vis = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) {
      if (mask[i] || seen[i] || vis[i]) continue;
      var comp = [i], k = 0; vis[i] = 1;
      while (k < comp.length) { var c = comp[k++], cx = c % w, cy = (c / w) | 0, ns = [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, cy > 0 ? c - w : -1, cy < h - 1 ? c + w : -1];
        for (var j = 0; j < 4; j++) { var n = ns[j]; if (n >= 0 && !mask[n] && !seen[n] && !vis[n]) { vis[n] = 1; comp.push(n); } } }
      if (comp.length <= lim) for (k = 0; k < comp.length; k++) out[comp[k]] = 1;
    }
    return out;
  }

  /** Outer boundary by Moore-neighbour tracing; returns pixel coordinates in order. */
  function trace(mask, w, h) {
    var sx = -1, sy = -1, i;
    for (i = 0; i < w * h; i++) if (mask[i]) { sx = i % w; sy = (i / w) | 0; break; }
    if (sx < 0) return [];
    var D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    function m(x, y) { return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1; }
    var pts = [], x = sx, y = sy, b = 4, guard = w * h * 2;
    do {
      pts.push([x, y]); var found = false;
      for (i = 0; i < 8; i++) {
        var d = (b + 1 + i) % 8, nx = x + D[d][0], ny = y + D[d][1];
        if (m(nx, ny)) {
          var pd = (b + i) % 8, bx = x + D[pd][0] - nx, by = y + D[pd][1] - ny;
          for (var k = 0; k < 8; k++) if (D[k][0] === bx && D[k][1] === by) { b = k; break; }
          x = nx; y = ny; found = true; break;
        }
      }
      if (!found) break;
    } while (!(x === sx && y === sy) && pts.length < guard);
    return pts;
  }

  function rdp(pts, eps) {
    if (pts.length < 4) return pts.slice();
    var keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]]; keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      var s = stack.pop(), a = pts[s[0]], c = pts[s[1]], dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy) || 1, best = -1, bi = -1;
      for (var i = s[0] + 1; i < s[1]; i++) { var dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + c[0] * a[1] - c[1] * a[0]) / len; if (dd > best) { best = dd; bi = i; } }
      if (best > eps && bi > 0) { keep[bi] = 1; stack.push([s[0], bi], [bi, s[1]]); }
    }
    return pts.filter(function (_, i) { return keep[i]; });
  }
  /** Simplify a closed ring: split at the two points farthest apart so the seam is not special. */
  function simplifyRing(ring, eps, maxPoints) {
    if (ring.length < 8) return ring.slice();
    var half = ring.length >> 1, e = eps, out;
    do {
      var a = rdp(ring.slice(0, half + 1), e), b = rdp(ring.slice(half).concat([ring[0]]), e);
      out = a.concat(b.slice(1, -1)); e *= 1.4;
    } while (out.length > (maxPoints || 200) && e < 60);
    return out;
  }
  function toSVG(ring, bbox, pad) {
    pad = pad == null ? 2 : pad;
    var ox = bbox[0] - pad, oy = bbox[1] - pad, W = bbox[2] + pad * 2, H = bbox[3] + pad * 2;
    var d = ring.map(function (p, i) { return (i ? "L" : "M") + (p[0] - ox + 0.5).toFixed(1) + " " + (p[1] - oy + 0.5).toFixed(1); }).join("") + "Z";
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '"><path d="' + d + '"/></svg>', d: d, w: W, h: H, points: ring.length };
  }

  /* ---------------- descriptions ---------------- */
  function colorName(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn, hu = 0;
    if (dl > 0.001) { if (mx === r) hu = ((g - b) / dl + 6) % 6; else if (mx === g) hu = (b - r) / dl + 2; else hu = (r - g) / dl + 4; hu *= 60; }
    var s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
    var base = s < 0.14 ? "grey" : hu < 15 || hu >= 345 ? "red" : hu < 40 ? "orange" : hu < 70 ? "yellow" : hu < 160 ? "green" : hu < 200 ? "teal" : hu < 255 ? "blue" : hu < 300 ? "purple" : "pink";
    return (l < 0.2 ? "dark " : l > 0.78 ? "pale " : "") + base;
  }
  function placeName(cx, cy, w, h) { var xs = cx < w / 3 ? "left" : cx > 2 * w / 3 ? "right" : "middle", ys = cy < h / 3 ? "top" : cy > 2 * h / 3 ? "bottom" : "centre"; return ys === "centre" ? xs : ys + " " + xs; }

  function describe(orig, w, h) {
    var buckets = {}, edges = 0, i;
    for (i = 0; i < w * h; i += 3) { var c = rgb(orig[i]), k = (c[0] >> 5) + "," + (c[1] >> 5) + "," + (c[2] >> 5); (buckets[k] = buckets[k] || { n: 0, r: 0, g: 0, b: 0 }); var bk = buckets[k]; bk.n++; bk.r += c[0]; bk.g += c[1]; bk.b += c[2]; }
    var pal = Object.keys(buckets).map(function (k) { return buckets[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6).map(function (b) { return hex([b.r / b.n, b.g / b.n, b.b / b.n]); });
    for (i = 0; i < w * h - 1; i++) if (Math.abs(luma(orig[i]) - luma(orig[i + 1])) > 24) edges++;
    var best = 0, bi = 0; for (i = 0; i < w * h; i += 2) { var lv = luma(orig[i]); if (lv > best) { best = lv; bi = i; } }
    return { size: [w, h], palette: pal, edge_density: +(edges / (w * h)).toFixed(3), brightest: [(bi % w) / w, ((bi / w) | 0) / h].map(function (n) { return +n.toFixed(3); }) };
  }

  /** Candidate objects: seed on a grid, grow each unclaimed seed, keep sizeable, non-frame-filling regions. */
  function listObjects(orig, w, h, minPct, max) {
    var claimed = new Uint8Array(w * h), out = [], gx = 10, gy = 6;
    for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) {
      var x = Math.round((i + 0.5) * w / gx), y = Math.round((j + 0.5) * h / gy);
      if (claimed[y * w + x]) continue;
      var r = segment(orig, w, h, x, y, 28, 70);
      for (var p = 0; p < r.mask.length; p++) if (r.mask[p]) claimed[p] = 1;
      if (r.areaPct >= (minPct || 1) && !r.leaked) out.push(r);
    }
    out.sort(function (a, b) { return b.areaPct - a.areaPct; });
    return out.slice(0, max || 8).map(function (r, n) {
      var lm = 0.299 * r.mean[0] + 0.587 * r.mean[1] + 0.114 * r.mean[2];
      return { id: "r" + (n + 1), name: colorName(r.mean) + " · " + placeName(r.center[0], r.center[1], w, h), seed: r.seed, bbox: r.bbox, area_pct: +r.areaPct.toFixed(1), mean_color: hex(r.mean), luma: lm, center: r.center, _r: r };
    });
  }

  /** A full cut-out: segment, fill small holes, trace, simplify. Returns everything the UI needs. */
  function cutout(orig, w, h, x, y, tol, opts) {
    opts = opts || {};
    var r = segment(orig, w, h, x, y, tol, opts.maxAreaPct || 45);
    if (r.leaked) return { ok: false, reason: "leak", message: "That region spreads over too much of the picture (over " + (opts.maxAreaPct || 45) + "%). Try a lower tolerance, or click a more distinct spot." };
    if (r.area < 40) return { ok: false, reason: "tiny", message: "Too small to make a shape from. Raise the tolerance or click a bigger area." };
    var mask = fillHoles(r.mask, w, h, 0.3), ring = trace(mask, w, h);
    if (ring.length < 8) return { ok: false, reason: "tiny", message: "Couldn’t find a clean outline there." };
    var ring2 = simplifyRing(ring, opts.eps || 1.4, opts.maxPoints || 200), svg = toSVG(ring2, r.bbox);
    return { ok: true, mask: mask, region: r, ring: ring, svg: svg, pointsBefore: ring.length, pointsAfter: ring2.length, areaPct: r.areaPct, mean: r.mean, name: colorName(r.mean), place: placeName(r.center[0], r.center[1], w, h) };
  }

  /* ---------------- the scripted "model" ---------------- */
  function plan(prompt, objs) {
    var p = (prompt || "").toLowerCase();
    var wantList = /(what|which|list|distinct|objects|see|there)/.test(p) && !/(cut|cutout|shape of|make)/.test(p);
    var wantBright = /(bright|sun|moon|glow|light|lamp)/.test(p);
    var wantDark = /(dark|ridge|hill|mountain|tree|silhouette|shadow|land)/.test(p);
    var wantSubject = /(subject|main|cut ?out|shape of|make a shape|outline)/.test(p);
    if (wantList) return { kind: "list" };
    if (wantBright) return { kind: "shape", pick: "bright", name: /sun/.test(p) ? "Sun" : /moon/.test(p) ? "Moon" : "Bright spot" };
    if (wantDark) return { kind: "shape", pick: "dark", name: /(ridge|hill|mountain)/.test(p) ? "Ridge" : "Dark shape" };
    if (wantSubject) return { kind: "shape", pick: "subject", name: null };
    return { kind: "none" };
  }
  function pickObject(objs, how, w, h) {
    var c = objs.filter(function (o) { return o.area_pct < 55; });
    if (!c.length) return null;
    if (how === "bright") { var b = c.filter(function (o) { return o.area_pct < 20; }); b.sort(function (a, z) { return z.luma - a.luma; }); return b[0] || c[0]; }
    if (how === "dark") { var dk = c.filter(function (o) { return o.area_pct > 2; }); dk.sort(function (a, z) { return a.luma - z.luma; }); return dk[0] || c[0]; }
    var mean = [128, 128, 128];
    c.forEach(function (o) { var dx = (o.center[0] - w / 2) / w, dy = (o.center[1] - h / 2) / h; o._s = Math.sqrt(o.area_pct) * (1 - Math.hypot(dx, dy)) * (1 + Math.abs(o.luma - 110) / 110); });
    c.sort(function (a, z) { return z._s - a._s; }); return c[0];
  }

  root.Assistant = { load: load, save: save, DEFAULTS: DEFAULTS, segment: segment, fillHoles: fillHoles, trace: trace, simplifyRing: simplifyRing, toSVG: toSVG,
    describe: describe, listObjects: listObjects, cutout: cutout, colorName: colorName, placeName: placeName, plan: plan, pickObject: pickObject, luma: luma, hex: hex };
})(window);
