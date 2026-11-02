/*
 * MOCKUP-ONLY region generators (see PLAN.md section 3.4). In the real app these polygon fills live in
 * the Go engine; here they are plain per-pixel loops so the Regions UI can be tried for real.
 *
 *   tessellate(w, h, {shape, size, gap, rotate, seed}) -> {labels:Uint16Array, ci[], cj[], count}
 *       label 0 = gap / background, 1..count = cells
 *   classify(tess, pattern, k)                          -> Uint8Array classOfCell (cell 0 -> class 0)
 *   overlay(ctx, w, h, tess, classOfCell, colors, on)   -> draws cell outlines + class tint
 *   icon(shape, px)                                     -> data URL of a tiny outline preview
 */
(function () {
  var SQ3 = Math.sqrt(3);
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return n >>> 0; }

  /* even-odd point-in-polygon rasterised once into an M x M bitmap (unit-square coordinates) */
  function polyBits(poly, M) {
    var bits = new Uint8Array(M * M), n = poly.length;
    for (var y = 0; y < M; y++) for (var x = 0; x < M; x++) {
      var px = (x + 0.5) / M, py = (y + 0.5) / M, inside = false;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var xa = poly[a][0], ya = poly[a][1], xb = poly[b][0], yb = poly[b][1];
        if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) inside = !inside;
      }
      bits[y * M + x] = inside ? 1 : 0;
    }
    return bits;
  }

  /* fit any outline into the unit square, keeping its proportions, centred */
  function normalizePoly(pts) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
    var w = x1 - x0 || 1, h = y1 - y0 || 1, sc = 0.92 / Math.max(w, h), ox = (1 - w * sc) / 2, oy = (1 - h * sc) / 2;
    return pts.map(function (p) { return [(p[0] - x0) * sc + ox, (p[1] - y0) * sc + oy]; });
  }

  var NS = "http://www.w3.org/2000/svg";
  /* sample a path (or basic shape) into a polygon using the browser's own geometry API */
  function flattenPathD(d) {
    var host = document.createElementNS(NS, "svg"); host.setAttribute("style", "position:fixed;left:-9999px;top:0;width:0;height:0");
    var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); host.appendChild(p); document.body.appendChild(host);
    var out = [];
    try { var L = p.getTotalLength(), N = Math.min(220, Math.max(28, Math.round(L / 2.5))); for (var k = 0; k < N; k++) { var q = p.getPointAtLength(k / N * L); out.push([q.x, q.y]); } } catch (e) { out = []; }
    document.body.removeChild(host); return out;
  }
  var STARTERS = [
    { name: "Star", d: "M50 5 L61 38 L96 38 L68 59 L79 93 L50 72 L21 93 L32 59 L4 38 L39 38 Z" },
    { name: "Heart", d: "M50 88 C20 66 6 48 6 32 C6 18 17 9 30 9 C40 9 47 15 50 22 C53 15 60 9 70 9 C83 9 94 18 94 32 C94 48 80 66 50 88 Z" },
    { name: "Drop", d: "M50 6 C50 6 18 44 18 64 C18 82 32 94 50 94 C68 94 82 82 82 64 C82 44 50 6 50 6 Z" },
    { name: "Bolt", d: "M58 4 L20 56 L46 56 L38 96 L80 40 L54 40 Z" },
    { name: "Moon", d: "M62 6 C36 10 18 30 18 54 C18 78 38 94 62 94 C74 94 84 90 90 84 C66 84 50 70 50 52 C50 34 62 18 84 14 C78 9 70 6 62 6 Z" },
    { name: "Leaf", d: "M12 88 C12 40 46 8 90 10 C92 54 60 90 12 88 Z" },
    { name: "Cross", d: "M38 6 H62 V38 H94 V62 H62 V94 H38 V62 H6 V38 H38 Z" },
    { name: "Arrow", d: "M50 4 L92 46 H66 V96 H34 V46 H8 Z" }
  ];
  STARTERS.forEach(function (s) { s.poly = null; });
  function starterPoly(i) { var s = STARTERS[i]; if (!s.poly) s.poly = normalizePoly(flattenPathD(s.d)); return s.poly; }

  /* parse user SVG text -> {poly, info} or {error} */
  function parseSVG(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml");
    if (doc.querySelector("parsererror")) return { error: "That doesn’t parse as SVG." };
    var svg = doc.documentElement; if (!svg || svg.tagName.toLowerCase() !== "svg") return { error: "No <svg> found in that file." };
    var els = [].slice.call(svg.querySelectorAll("path,polygon,polyline,circle,ellipse,rect"));
    if (!els.length) return { error: "No shapes in there — I look for path, polygon, circle, ellipse and rect." };
    var host = document.createElementNS(NS, "svg"); host.setAttribute("style", "position:fixed;left:-9999px;top:0;width:0;height:0"); document.body.appendChild(host);
    var best = null, bestLen = 0, extra = false;
    els.forEach(function (e) {
      var c = document.importNode(e, true);
      if (c.tagName.toLowerCase() === "path") { var d = c.getAttribute("d") || ""; var parts = d.split(/(?=[Mm])/).filter(function (x) { return x.trim(); }); if (parts.length > 1) { extra = true; c.setAttribute("d", parts[0]); } }
      host.appendChild(c); var L = 0; try { L = c.getTotalLength(); } catch (err) { L = 0; } if (L > bestLen) { bestLen = L; best = c; }
    });
    if (!best) { document.body.removeChild(host); return { error: "Couldn’t measure any outline in that SVG." }; }
    var pts = [], N = Math.min(240, Math.max(28, Math.round(bestLen / 2.5)));
    for (var k = 0; k < N; k++) { var q = best.getPointAtLength(k / N * bestLen); pts.push([q.x, q.y]); }
    document.body.removeChild(host);
    var note = els.length + " shape" + (els.length > 1 ? "s" : "") + " found" + (els.length > 1 ? ", using the largest" : "") + " · " + N + " points";
    if (extra) note += " · extra sub-paths (holes) ignored in this mockup";
    return { poly: normalizePoly(pts), info: note };
  }

  function polyIcon(poly, px) {
    var c = document.createElement("canvas"); c.width = px; c.height = px; var g = c.getContext("2d");
    g.fillStyle = "rgba(236,228,211,.14)"; g.strokeStyle = "rgba(236,228,211,.9)"; g.lineWidth = 1.5; g.lineJoin = "round";
    g.beginPath(); poly.forEach(function (p, i) { var x = p[0] * px, y = p[1] * px; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke();
    return c.toDataURL();
  }

  var SHAPES = [
    { id: "square", name: "Square" }, { id: "hexagon", name: "Hexagon" }, { id: "triangle", name: "Triangle" },
    { id: "diamond", name: "Diamond" }, { id: "circle", name: "Circle" }, { id: "octagon", name: "Octagon" },
    { id: "voronoi", name: "Voronoi" }
  ];

  function tessellate(w, h, o) {
    var shape = o.shape || "hexagon", S = Math.max(6, o.size || 60), gap = o.gap || 0, seed = o.seed || 1;
    var labels = new Uint16Array(w * h), cells = new Map(), ci = [0], cj = [0];
    var cx0 = w / 2, cy0 = h / 2, th = -(o.rotate || 0) * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    var OFF = S * 200;
    function cell(key, i, j) { var id = cells.get(key); if (id === undefined) { id = ci.length; cells.set(key, id); ci.push(i); cj.push(j); } return id; }
    var seeds = null, bits = null, M = 72;
    if (shape === "custom") {
      bits = polyBits(o.poly || STARTERS[0].poly, M);
    }
    if (shape === "voronoi") {
      var rng = mulberry32(seed * 977), n = Math.max(6, Math.round((w * h) / (S * S * 1.1)));
      seeds = []; for (var q = 0; q < n; q++) seeds.push([rng() * w, rng() * h]);
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var X = x - cx0, Y = y - cy0;
        var rx = X * ct - Y * st + cx0 + OFF, ry = X * st + Y * ct + cy0 + OFF, id = 0, i, j, lx, ly, R;
        if (shape === "custom") {
          var rj = Math.floor(ry / S), sx = (o.stagger && (rj & 1)) ? S / 2 : 0;
          var ux2 = rx + sx; i = Math.floor(ux2 / S); j = rj;
          var u0 = ux2 / S - i, v0 = ry / S - j, sc = Math.max(0.06, (S - gap) / S);
          var uu = (u0 - 0.5) / sc + 0.5, vv = (v0 - 0.5) / sc + 0.5;
          if (uu >= 0 && uu < 1 && vv >= 0 && vv < 1 && bits[Math.floor(vv * M) * M + Math.floor(uu * M)]) id = cell("c" + i + "," + j, i, j);
        } else if (shape === "voronoi") {
          var d1 = 1e9, d2 = 1e9, b = 0;
          for (var s = 0; s < seeds.length; s++) { var dx = x - seeds[s][0], dy = y - seeds[s][1], dd = dx * dx + dy * dy; if (dd < d1) { d2 = d1; d1 = dd; b = s; } else if (dd < d2) d2 = dd; }
          if (Math.sqrt(d2) - Math.sqrt(d1) >= gap) id = cell("v" + b, b, 0);
        } else if (shape === "hexagon") {
          var Rc = S / 2, qf = (SQ3 / 3 * rx - ry / 3) / Rc, rf = (2 / 3 * ry) / Rc, xf = qf, zf = rf, yf = -xf - zf;
          var rxx = Math.round(xf), ryy = Math.round(yf), rzz = Math.round(zf);
          var ex = Math.abs(rxx - xf), ey = Math.abs(ryy - yf), ez = Math.abs(rzz - zf);
          if (ex > ey && ex > ez) rxx = -ryy - rzz; else if (ey > ez) ryy = -rxx - rzz; else rzz = -rxx - ryy;
          var ccx = Rc * SQ3 * (rxx + rzz / 2), ccy = Rc * 1.5 * rzz;
          lx = Math.abs(rx - ccx); ly = Math.abs(ry - ccy); R = Rc - gap * 0.6;
          if (lx <= R * SQ3 / 2 && ly + lx / SQ3 <= R) id = cell("h" + rxx + "," + rzz, rxx, rzz);
        } else if (shape === "triangle") {
          var u = (rx - ry / SQ3) / S, v = (2 * ry / SQ3) / S; i = Math.floor(u); j = Math.floor(v);
          var fu = u - i, fv = v - j, half = fu + fv < 1 ? 0 : 1;
          var l1 = half ? 1 - fu : fu, l2 = half ? 1 - fv : fv, l3 = half ? fu + fv - 1 : 1 - fu - fv;
          if (Math.min(l1, l2, l3) * S * SQ3 / 2 >= gap / 2) id = cell("t" + i + "," + j + "," + half, i * 2 + half, j);
        } else {
          var ux = rx, uy = ry;
          if (shape === "diamond") { ux = (rx + ry) / Math.SQRT2; uy = (ry - rx) / Math.SQRT2; }
          i = Math.floor(ux / S); j = Math.floor(uy / S); lx = ux - (i + 0.5) * S; ly = uy - (j + 0.5) * S; R = S / 2 - gap / 2;
          var ok = Math.abs(lx) <= R && Math.abs(ly) <= R;
          if (ok && shape === "circle") ok = lx * lx + ly * ly <= R * R;
          if (ok && shape === "octagon") ok = Math.abs(lx) + Math.abs(ly) <= R * 1.4142;
          if (ok) id = cell("s" + i + "," + j, i, j);
        }
        labels[y * w + x] = id;
      }
    }
    return { labels: labels, ci: ci, cj: cj, count: ci.length - 1 };
  }

  /* pattern: all | checker | thirds | random ; returns classOfCell (class 0 is reserved for the gap/background) */
  function classify(t, pattern, k, seed) {
    var n = t.ci.length, out = new Uint8Array(n);
    for (var id = 1; id < n; id++) {
      var i = t.ci[id], j = t.cj[id], c = 1;
      if (pattern === "checker") c = 1 + (((i + j) % 2) + 2) % 2;
      else if (pattern === "thirds") c = 1 + (((i + j) % 3) + 3) % 3;
      else if (pattern === "random") c = 1 + hash(id * 2654435761 + (seed || 1)) % Math.max(1, k || 3);
      out[id] = c;
    }
    return out;
  }

  /* outlines + a faint tint per class */
  function overlay(ctx, w, h, t, classOfCell, colors, on) {
    ctx.clearRect(0, 0, w, h);
    if (!t || on === false) return;
    var id = ctx.createImageData(w, h), d = id.data, L = t.labels;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, lab = L[i], p = i * 4;
      var edge = (x + 1 < w && L[i + 1] !== lab) || (y + 1 < h && L[i + w] !== lab);
      if (edge) { d[p] = 236; d[p + 1] = 228; d[p + 2] = 211; d[p + 3] = 150; continue; }
      if (lab) { var c = colors[classOfCell[lab]] || colors[0]; d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 46; }
    }
    ctx.putImageData(id, 0, 0);
  }

  function icon(shape, px) {
    var c = document.createElement("canvas"); c.width = px; c.height = px;
    var g = c.getContext("2d"), t = tessellate(px, px, { shape: shape, size: px / 2.6, gap: 1.2, rotate: shape === "triangle" ? 0 : 0, seed: 4 });
    var id = g.createImageData(px, px);
    for (var y = 0; y < px; y++) for (var x = 0; x < px; x++) {
      var i = y * px + x, lab = t.labels[i], p = i * 4;
      var edge = lab && ((x + 1 < px && t.labels[i + 1] !== lab) || (y + 1 < px && t.labels[i + px] !== lab) || x === 0 || y === 0);
      if (edge) { id.data[p] = 236; id.data[p + 1] = 228; id.data[p + 2] = 211; id.data[p + 3] = 230; }
      else if (lab) { id.data[p] = 236; id.data[p + 1] = 228; id.data[p + 2] = 211; id.data[p + 3] = 26; }
    }
    g.putImageData(id, 0, 0);
    return c.toDataURL();
  }

  window.Regions = { polyBits: polyBits, STARTERS: STARTERS, starterPoly: starterPoly, parseSVG: parseSVG, polyIcon: polyIcon, normalizePoly: normalizePoly, SHAPES: SHAPES, tessellate: tessellate, classify: classify, overlay: overlay, icon: icon };
})();
