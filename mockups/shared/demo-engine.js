/*
 * MOCKUP-ONLY sorting demo.
 *
 * This is NOT the real engine (that will be Go compiled to WASM, see PLAN.md). It is a small JS
 * stand-in so the mockups can actually animate: scanlines at ANY angle -> intervals -> stable
 * stepped sorts, with frozen pixels (masks / threshold), cellular-automaton cuts, and a synthetic
 * image so there are no assets to load. Classic script so mockups open straight from file://.
 *
 * Angle: 0 = left->right, increasing angle rotates the sort direction counter-clockwise on screen
 * (90 = bottom->top). No image rotation happens: pixels are partitioned into staircase lines with
 * k = y - round(x * tan(theta)) (PLAN.md section 3.2), so it is a pure permutation at every angle.
 */
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- synthetic artwork (sunset over ridges + grain) ---------- */
  function makeArt(w, h, seed) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const r = mulberry32(seed || 7);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#14184f");
    sky.addColorStop(0.42, "#b83a6e");
    sky.addColorStop(0.68, "#ff8f4a");
    sky.addColorStop(1, "#ffd98a");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);

    const sx = w * (0.52 + r() * 0.2), sy = h * 0.56;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
    sg.addColorStop(0, "rgba(255,252,226,1)");
    sg.addColorStop(0.11, "rgba(255,238,176,1)");
    sg.addColorStop(0.125, "rgba(255,176,96,.6)");
    sg.addColorStop(1, "rgba(255,120,80,0)");
    g.fillStyle = sg; g.fillRect(0, 0, w, h);

    for (let i = 0; i < 220; i++) {
      g.fillStyle = "rgba(255,255,255," + (r() * 0.75).toFixed(2) + ")";
      g.fillRect(r() * w, r() * h * 0.42, 1.3, 1.3);
    }
    const layers = [["#4a2f78", 0.6, 0.05], ["#2b1c5a", 0.7, 0.07], ["#150f35", 0.8, 0.09]];
    layers.forEach(function (L, i) {
      g.fillStyle = L[0]; g.beginPath(); g.moveTo(0, h);
      const ph = r() * 6;
      for (let x = 0; x <= w; x += 4) {
        const y = h * L[1] + Math.sin(x * 0.012 * (i + 1) + ph) * h * L[2] + Math.sin(x * 0.043 + i * 2 + ph) * h * L[2] * 0.4;
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
    });
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() > 0.5 ? "#ffd98a" : "#ff7a59";
      g.fillRect(r() * w, h * (0.78 + r() * 0.2), 2, 2);
    }
    const id = g.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    return id;
  }

  /* ---------- elementary cellular automaton, nearest-neighbour expanded ---------- */
  function caMap(w, h, rule, cell, seed) {
    const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
    const r = mulberry32((seed || 1) * 31 + rule);
    const rows = [];
    let prev = new Uint8Array(cw);
    for (let x = 0; x < cw; x++) prev[x] = r() < 0.5 ? 1 : 0;
    rows.push(prev);
    for (let y = 1; y < ch; y++) {
      const cur = new Uint8Array(cw);
      cur[0] = r() < 0.5 ? 1 : 0; cur[cw - 1] = r() < 0.5 ? 1 : 0;
      for (let x = 1; x < cw - 1; x++) {
        const idx = (prev[x - 1] << 2) | (prev[x] << 1) | prev[x + 1];
        cur[x] = (rule >> idx) & 1;
      }
      rows.push(cur); prev = cur;
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = rows[Math.min(ch - 1, (y / cell) | 0)];
      for (let x = 0; x < w; x++) out[y * w + x] = row[Math.min(cw - 1, (x / cell) | 0)];
    }
    return out;
  }

  const DEFAULTS = {
    mode: "random",      // random | wave | threshold | edges | ca | none
    key: "luma",         // luma | value | intensity | hue | saturation | red | green | blue
    algo: "oddeven",     // oddeven | insertion | reveal
    length: 40, randomness: 10, lo: 0.2, hi: 0.82, edge: 26,
    rule: 110, cell: 4, angle: 0, seed: 7, reverse: false
  };

  function PixelDemo(canvas, opts) {
    opts = opts || {};
    this.w = opts.w || 480; this.h = opts.h || 300;
    this.canvas = canvas;
    if (canvas) { canvas.width = this.w; canvas.height = this.h; this.ctx = canvas.getContext("2d"); }
    const n = this.w * this.h;
    this.imgData = new ImageData(this.w, this.h);
    this.px = new Uint32Array(this.imgData.data.buffer);
    this.orig = new Uint32Array(n);
    this.key = new Uint8Array(n);
    this.thr = new Uint8Array(n);
    this.mask = new Uint8Array(n);
    this.P = new Int32Array(n);
    this.labels = null; this.classOfCell = null; this.classDefs = null; this.rclass = null; // regions
    this.feather = 0; this.soft = null;                                                         // soft mask
    this.outImg = new ImageData(this.w, this.h); this.out32 = new Uint32Array(this.outImg.data.buffer);
    this.params = Object.assign({}, DEFAULTS, opts.params || {});
    this.speed = 24; this.running = false; this.comparing = false; // speed = steps per second
    this.pass = 0; this.done = false; this.progress = 0;
    this.onframe = null; this._raf = 0;
    this.loadArt(this.params.seed);
  }

  PixelDemo.caMap = caMap;
  PixelDemo.makeArt = makeArt;
  PixelDemo.DEFAULTS = DEFAULTS;

  PixelDemo.prototype.loadArt = function (seed) {
    const id = makeArt(this.w, this.h, seed);
    this.orig.set(new Uint32Array(id.data.buffer));
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const p = this.orig[i], r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
      this.thr[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }
    this.reset();
  };

  /* load a user's picture (cover-fit into the working size) */
  PixelDemo.prototype.loadImage = function (img) {
    const c = document.createElement("canvas"); c.width = this.w; c.height = this.h;
    const g = c.getContext("2d");
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(this.w / iw, this.h / ih), dw = iw * s, dh = ih * s;
    g.drawImage(img, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
    const id = g.getImageData(0, 0, this.w, this.h);
    this.orig.set(new Uint32Array(id.data.buffer));
    for (let i = 0; i < this.orig.length; i++) {
      const p = this.orig[i], r = p & 255, gg = (p >> 8) & 255, b = (p >> 16) & 255;
      this.thr[i] = (0.299 * r + 0.587 * gg + 0.114 * b) | 0;
    }
    this.reset();
  };

  /*
   * Regions: labels[pos] = cell id (Uint16), classOfCell[cell] = class id (Uint8), defs[class] =
   * { frozen?, angle?, key? }. Intervals never cross cells; a class can override angle / key or freeze.
   */
  PixelDemo.prototype.setRegions = function (r) {
    if (!r) { this.labels = null; this.classOfCell = null; this.classDefs = null; this.rclass = null; this.reset(); return; }
    this.labels = r.labels; this.classOfCell = r.classOfCell; this.classDefs = r.defs;
    const n = this.w * this.h, rc = new Uint8Array(n);
    for (let i = 0; i < n; i++) rc[i] = r.classOfCell[r.labels[i]] || 0;
    this.rclass = rc; this.reset();
  };
  PixelDemo.prototype.setRegionDefs = function (defs) { this.classDefs = defs; this.reset(); };

  /* feather: blur radius in px; the mask stays a hard barrier, the edge just blends back to the original */
  PixelDemo.prototype.setFeather = function (rad) {
    this.feather = rad; this._softMask(); this.draw();
  };
  PixelDemo.prototype._softMask = function () {
    const w = this.w, h = this.h, r = Math.round(this.feather);
    if (!r) { this.soft = null; return; }
    let a = new Float32Array(w * h), b = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = this.mask[i] ? 1 : 0;
    const k = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[y * w + x] = acc * k; acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = acc * k; acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
    this.soft = a;
  };

  PixelDemo.prototype.setParams = function (p) { Object.assign(this.params, p); this.reset(); };
  PixelDemo.prototype.setMask = function (m) { this.mask = m; this._softMask(); this.reset(); };

  PixelDemo.prototype._computeKeys = function () {
    const gk = this.params.key, gRev = this.params.reverse, n = this.w * this.h, o = this.orig, key = this.key, rc = this.rclass, defs = this.classDefs;
    for (let i = 0; i < n; i++) {
      const p = o[i], r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
      const cd = (rc && defs && defs[rc[i]]) || null;
      const k = (cd && cd.key) || gk;
      const rev = cd && cd.reverse != null ? cd.reverse : gRev;
      let v;
      if (k === "luma") v = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      else if (k === "value") v = Math.max(r, g, b);
      else if (k === "intensity") v = ((r + g + b) / 3) | 0;
      else if (k === "red") v = r;
      else if (k === "green") v = g;
      else if (k === "blue") v = b;
      else {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (k === "saturation") v = mx === 0 ? 0 : ((d / mx) * 255) | 0;
        else { // hue
          let hh = 0;
          if (d) {
            if (mx === r) hh = ((g - b) / d) % 6;
            else if (mx === g) hh = (b - r) / d + 2;
            else hh = (r - g) / d + 4;
            hh = (hh < 0 ? hh + 6 : hh) / 6;
          }
          v = (hh * 255) | 0;
        }
      }
      key[i] = rev ? 255 - v : v;
    }
  };

  /*
   * Partition every pixel into exactly one staircase line for the current angle. P is the flat list
   * of pixel positions grouped by line (in walking order); lineStarts[l] .. lineStarts[l+1] is line l.
   */
  PixelDemo.prototype._partition = function (angle) {
    const w = this.w, h = this.h, P = new Int32Array(w * h);
    const th = (angle * Math.PI) / 180;
    let dx = Math.cos(th), dy = -Math.sin(th); // screen coords: y grows downward
    if (Math.abs(dx) < 1e-9) dx = 0;
    if (Math.abs(dy) < 1e-9) dy = 0;
    const starts = []; let n = 0;
    if (Math.abs(dx) >= Math.abs(dy)) {            // walk along x
      const m = dy / dx, sx = dx > 0 ? 1 : -1;
      let kmin = Infinity, kmax = -Infinity;
      [0, w - 1].forEach(function (x) { [0, h - 1].forEach(function (y) { const k = y - Math.round(x * m); if (k < kmin) kmin = k; if (k > kmax) kmax = k; }); });
      for (let k = kmin; k <= kmax; k++) {
        const s0 = n;
        for (let i = 0; i < w; i++) {
          const x = sx > 0 ? i : w - 1 - i, y = k + Math.round(x * m);
          if (y >= 0 && y < h) P[n++] = y * w + x;
        }
        if (n > s0) starts.push(s0);
      }
    } else {                                        // walk along y
      const m = dx / dy, sy = dy > 0 ? 1 : -1;
      let kmin = Infinity, kmax = -Infinity;
      [0, h - 1].forEach(function (y) { [0, w - 1].forEach(function (x) { const k = x - Math.round(y * m); if (k < kmin) kmin = k; if (k > kmax) kmax = k; }); });
      for (let k = kmin; k <= kmax; k++) {
        const s0 = n;
        for (let i = 0; i < h; i++) {
          const y = sy > 0 ? i : h - 1 - i, x = k + Math.round(y * m);
          if (x >= 0 && x < w) P[n++] = y * w + x;
        }
        if (n > s0) starts.push(s0);
      }
    }
    starts.push(n);
    return { P: P, starts: starts };
  };

  /*
   * Partition every pixel into exactly one staircase line for the current angle. P is the flat list
   * of pixel positions grouped by line (in walking order); lineStarts[l] .. lineStarts[l+1] is line l.
   * With regions, each class is walked at its own angle and lines are cut wherever the cell changes
   * or a pixel of another class interrupts them.
   */
  PixelDemo.prototype._lines = function () {
    if (!this.labels) {
      const r = this._partition(this.params.angle);
      this.P = r.P; this.lineStarts = r.starts; this.nLines = r.starts.length - 1; return;
    }
    const w = this.w, h = this.h, labels = this.labels, rc = this.rclass, defs = this.classDefs || {};
    const P = new Int32Array(w * h), starts = []; let n = 0;
    const used = {};
    for (let i = 0; i < rc.length; i++) used[rc[i]] = 1;
    const groups = {}; // angle -> {classes:Set}
    Object.keys(used).forEach((c) => {
      const d = defs[c], a = d && d.angle != null ? d.angle : this.params.angle;
      (groups[a] = groups[a] || new Set()).add(+c);
    });
    Object.keys(groups).forEach((a) => {
      const part = this._partition(+a), cls = groups[a], P0 = part.P, st = part.starts;
      for (let l = 0; l < st.length - 1; l++) {
        let open = -1, prev = -1;
        for (let i = st[l]; i < st[l + 1]; i++) {
          const pos = P0[i];
          if (!cls.has(rc[pos])) { if (open >= 0) open = -1; prev = -1; continue; }
          const cell = labels[pos];
          if (open >= 0 && cell !== prev) open = -1;
          if (open < 0) { open = n; starts.push(n); }
          P[n++] = pos; prev = cell;
        }
      }
    });
    starts.push(n);
    this.P = P; this.lineStarts = starts; this.nLines = starts.length - 1;
  };

  /* effective cutting parameters for one region class: its own override, else the global setting */
  PixelDemo.prototype._classParams = function (c) {
    const p = this.params, d = (this.classDefs && this.classDefs[c]) || {};
    const pick = function (k) { return d[k] != null ? d[k] : p[k]; };
    return { mode: pick("mode"), length: pick("length"), randomness: pick("randomness"), lo: pick("lo") * 255, hi: pick("hi") * 255,
             edge: pick("edge"), rule: pick("rule"), cell: pick("cell"), algo: pick("algo"), frozen: !!d.frozen };
  };

  PixelDemo.prototype._build = function () {
    this._lines();
    const p = this.params, P = this.P, starts = this.lineStarts, w = this.w, h = this.h;
    const rc = this.rclass, mask = this.mask, thr = this.thr;
    let maxClass = 0;
    if (this.classDefs) Object.keys(this.classDefs).forEach(function (k) { if (+k > maxClass) maxClass = +k; });
    const CP = []; for (let c = 0; c <= maxClass; c++) CP[c] = this._classParams(c);
    const caCache = {};
    const caFor = function (cp) { const k = cp.rule + "/" + cp.cell; return caCache[k] || (caCache[k] = caMap(w, h, cp.rule, cp.cell, p.seed)); };
    const cpAt = function (pos) { return (rc && CP[rc[pos]]) || CP[0]; };
    const fz = function (pos) { const cp = cpAt(pos); return mask[pos] || cp.frozen || (cp.mode === "threshold" && (thr[pos] < cp.lo || thr[pos] > cp.hi)); };
    const A = [], Bb = [];
    let frozen = 0, sortable = 0;

    for (let l = 0; l < this.nLines; l++) {
      const s = starts[l], len = starts[l + 1] - s;
      const rng = mulberry32(p.seed * 7919 + l * 104729);
      let t = 0;
      while (t < len) {
        if (fz(P[s + t])) { frozen++; t++; continue; }
        const r0 = t;
        while (t < len && !fz(P[s + t])) t++;
        const r1 = t, cp = cpAt(P[s + r0]), mean = Math.max(3, cp.length);
        const segs = [];
        if (cp.mode === "random" || cp.mode === "wave") {
          let c = r0;
          while (c < r1) {
            let wd;
            if (cp.mode === "random") wd = mean * 2 * rng();
            else wd = mean * (1 + 0.7 * Math.sin((c * 6.2831853) / (mean * 6) + l * 0.17)) * (0.9 + rng() * 0.2);
            const e = Math.min(r1, c + Math.max(2, Math.round(wd)));
            segs.push([c, e]); c = e;
          }
        } else if (cp.mode === "ca" || cp.mode === "edges") {
          const ca = cp.mode === "ca" ? caFor(cp) : null;
          let c = r0;
          for (let u = r0 + 1; u < r1; u++) {
            const a = P[s + u], b = P[s + u - 1];
            const cut = cp.mode === "ca" ? (ca[a] && !ca[b]) : Math.abs(thr[a] - thr[b]) > cp.edge;
            if (cut) { segs.push([c, u]); c = u; }
          }
          segs.push([c, r1]);
        } else segs.push([r0, r1]);

        for (let q = 0; q < segs.length; q++) {
          const a0 = segs[q][0], a1 = segs[q][1];
          if (a1 - a0 < 2) continue;
          if (rng() * 100 < cp.randomness) continue; // randomness = % of runs left unsorted
          A.push(s + a0); Bb.push(s + a1); sortable += a1 - a0;
        }
      }
    }
    this.ivA = Int32Array.from(A); this.ivB = Int32Array.from(Bb);
    this.ins = Int32Array.from(A, function (v) { return v + 1; });
    let maxLen = 1;
    for (let i = 0; i < A.length; i++) maxLen = Math.max(maxLen, Bb[i] - A[i]);
    this.maxLen = maxLen;
    /* each interval watches itself sort with its region's algorithm: 0 odd-even, 1 insertion, 2 reveal */
    const CODE = { oddeven: 0, insertion: 1, reveal: 2 }, al = new Uint8Array(A.length), cnt = [0, 0, 0], ml = [1, 1, 1], rev = [];
    for (let i = 0; i < A.length; i++) {
      const k = CODE[cpAt(P[A[i]]).algo] || 0; al[i] = k; cnt[k]++; ml[k] = Math.max(ml[k], Bb[i] - A[i]);
      if (k === 2) rev.push(i);
    }
    this.ivAlgo = al; this.algoCount = cnt; this.algoMaxLen = ml; this.revList = rev;
    this.stats = { intervals: A.length, sortable: sortable, frozen: frozen, lines: this.nLines };
    this.cursor = 0; this.zero = 0;
  };

  PixelDemo.prototype.reset = function () {
    this.px.set(this.orig);
    this._computeKeys();
    this._build();
    this.pass = 0; this.done = false; this.progress = 0;
    this.draw();
    this._emit();
  };

  PixelDemo.prototype._swap = function (a, b) {
    const px = this.px, key = this.key, tp = px[a], tk = key[a];
    px[a] = px[b]; px[b] = tp; key[a] = key[b]; key[b] = tk;
  };

  /* One pass. Every interval advances with its own algorithm (a region can override the global one); the three
     families run side by side and the sort is done when all of them are. A single algorithm everywhere behaves
     exactly as before. */
  PixelDemo.prototype.step = function () {
    if (this.done) return;
    const n = this.ivA.length, key = this.key, px = this.px, P = this.P, al = this.ivAlgo, H = this.algoCount, par = this.pass & 1;
    let swaps = 0, active = 0;
    for (let i = 0; i < n; i++) {
      const k = al[i]; if (k === 2) continue;
      const a0 = this.ivA[i], a1 = this.ivB[i];
      if (k === 0) {
        for (let t = a0 + ((a0 ^ par) & 1); t + 1 < a1; t += 2) {
          const a = P[t], b = P[t + 1];
          if (key[a] > key[b]) { this._swap(a, b); swaps++; }
        }
      } else {
        const t = this.ins[i];
        if (t >= a1) continue;
        const pa = P[t], kv = key[pa], pv = px[pa];
        let j = t - 1;
        while (j >= a0 && key[P[j]] > kv) {
          const from = P[j], to = P[j + 1];
          px[to] = px[from]; key[to] = key[from]; j--;
        }
        const dst = P[j + 1]; px[dst] = pv; key[dst] = kv;
        this.ins[i] = t + 1;
        if (t + 1 < a1) active++;
      }
    }
    const L = this.revList;
    if (H[2]) { // reveal: finish a chunk of this family's intervals completely
      const end = Math.min(L.length, this.cursor + Math.max(6, Math.ceil(L.length / 160)));
      for (let c = this.cursor; c < end; c++) this._sortInterval(L[c]);
      this.cursor = end;
    }
    if (H[0]) this.zero = swaps === 0 ? this.zero + 1 : 0;
    this.pass++;
    const oeDone = !H[0] || this.zero >= 2, insDone = !H[1] || active === 0, revDone = !H[2] || this.cursor >= L.length;
    this.done = oeDone && insDone && revDone;
    const tot = H[0] + H[1] + H[2], ML = this.algoMaxLen;
    const frac = tot ? (H[0] * (oeDone ? 1 : Math.min(0.99, this.pass / ML[0])) + H[1] * (insDone ? 1 : Math.min(0.99, this.pass / ML[1])) + H[2] * (revDone ? 1 : this.cursor / L.length)) / tot : 1;
    this.progress = this.done ? 1 : Math.min(0.99, frac);
  };

  PixelDemo.prototype._sortInterval = function (i) {
    const a0 = this.ivA[i], a1 = this.ivB[i], P = this.P;
    const items = [];
    for (let t = a0; t < a1; t++) { const a = P[t]; items.push([this.key[a], this.px[a]]); }
    items.sort(function (x, y) { return x[0] - y[0]; }); // Array.sort is stable
    for (let t = a0, k = 0; t < a1; t++, k++) { const a = P[t]; this.key[a] = items[k][0]; this.px[a] = items[k][1]; }
  };

  PixelDemo.prototype.instant = function () {
    this.px.set(this.orig); this._computeKeys();
    for (let i = 0; i < this.ivA.length; i++) this._sortInterval(i);
    this.done = true; this.progress = 1; this.draw(); this._emit();
  };

  PixelDemo.prototype.draw = function () {
    if (!this.ctx) return;
    if (!this.comparing && this.soft) {
      const soft = this.soft, px = this.px, o = this.orig, out = this.out32, n = px.length;
      for (let i = 0; i < n; i++) {
        const a = soft[i];
        if (a <= 0) { out[i] = px[i]; continue; }
        if (a >= 1) { out[i] = o[i]; continue; }
        const p = px[i], q = o[i], ia = 1 - a;
        const r = ((p & 255) * ia + (q & 255) * a) | 0, g = (((p >> 8) & 255) * ia + ((q >> 8) & 255) * a) | 0, b = (((p >> 16) & 255) * ia + ((q >> 16) & 255) * a) | 0;
        out[i] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
      this.ctx.putImageData(this.outImg, 0, 0);
      return;
    }
    if (this.comparing) {
      const tmp = new ImageData(new Uint8ClampedArray(new Uint32Array(this.orig).buffer), this.w, this.h);
      this.ctx.putImageData(tmp, 0, 0);
    } else this.ctx.putImageData(this.imgData, 0, 0);
  };

  PixelDemo.prototype._emit = function () {
    if (this.onframe) this.onframe({ pass: this.pass, progress: this.progress, done: this.done, running: this.running, stats: this.stats });
  };

  PixelDemo.prototype.play = function () {
    if (this.running) return;
    if (this.done) this.reset();
    this.running = true;
    const self = this;
    let last = performance.now(), acc = 0;
    (function tick(now) {
      if (!self.running) return;
      now = now || performance.now();
      acc += Math.min(0.1, (now - last) / 1000) * self.speed; last = now; // speed = steps per second
      const n = Math.min(300, Math.floor(acc)); acc -= n;
      for (let i = 0; i < n && !self.done; i++) self.step();
      if (n) self.draw();
      self._emit();
      if (self.done) { self.running = false; self._emit(); return; }
      self._raf = requestAnimationFrame(tick);
    })();
    this._emit();
  };
  PixelDemo.prototype.pause = function () { this.running = false; cancelAnimationFrame(this._raf); this._emit(); };
  PixelDemo.prototype.toggle = function () { this.running ? this.pause() : this.play(); };
  PixelDemo.prototype.restart = function () { const was = this.running; this.pause(); this.reset(); if (was) this.play(); };
  PixelDemo.prototype.compare = function (on) { this.comparing = on; this.draw(); };

  /* "live preview": re-sort instantly with new params while a control is being dragged */
  PixelDemo.prototype.livePreview = function (p) { this.pause(); Object.assign(this.params, p); this.reset(); this.instant(); };

  /* which pixels can move at all: 1 = free to sort, 0 = held still (protected, in a frozen region, or outside a
     threshold band). Mirrors the engine's own freeze test, so the "focus peaking" overlay never disagrees with a sort. */
  PixelDemo.prototype.sortable = function () {
    const n = this.w * this.h, out = new Uint8Array(n), rc = this.rclass, mask = this.mask, thr = this.thr, CP = [];
    let maxClass = 0;
    if (this.classDefs) Object.keys(this.classDefs).forEach(function (k) { if (+k > maxClass) maxClass = +k; });
    for (let c = 0; c <= maxClass; c++) CP[c] = this._classParams(c);
    for (let i = 0; i < n; i++) {
      const cp = (rc && CP[rc[i]]) || CP[0] || (CP[0] = this._classParams(0));
      out[i] = (mask[i] || cp.frozen || (cp.mode === "threshold" && (thr[i] < cp.lo || thr[i] > cp.hi))) ? 0 : 1;
    }
    return out;
  };

  PixelDemo.prototype.hist = function (bins) {
    bins = bins || 64; const out = new Array(bins).fill(0);
    for (let i = 0; i < this.thr.length; i++) out[Math.min(bins - 1, (this.thr[i] / 256 * bins) | 0)]++;
    return out;
  };

  /* cheap thumbnail: sort a small copy instantly and return a data URL */
  PixelDemo.thumb = function (params, w, h) {
    const p = Object.assign({}, params);
    if (p.dir != null && p.angle == null) { p.angle = p.dir; delete p.dir; } // old name
    const c = document.createElement("canvas");
    const d = new PixelDemo(c, { w: w || 160, h: h || 100, params: p });
    d.instant();
    return c.toDataURL("image/png");
  };

  window.PixelDemo = PixelDemo;
})();
