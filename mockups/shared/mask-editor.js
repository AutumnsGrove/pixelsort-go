/*
 * MOCKUP-ONLY mask editor (see PLAN.md section 3.4).
 *
 * A mask is a freehand brush layer PLUS any number of editable shape objects. Objects are stored
 * resolution-independently (centre and size as fractions of the picture, rotation in degrees), so the
 * preview and a full-resolution export agree; they are rasterised on demand into the engine's mask.
 *
 *   var ed = new MaskEditor({frame, w, h, onChange(phase), onSelect(obj)})
 *   ed.add({kind:'ellipse'|'rect'|'poly', poly?, cx?, cy?, w?, h?, rot?, mode:'add'|'cut', name?})
 *   ed.rasterize(out)        // writes 1 for 'add' shapes, 0 for 'cut' shapes, on top of whatever is in out
 *   ed.update(id, patch, phase) ed.remove(id) ed.duplicate(id) ed.clear() ed.select(id)
 *   ed.setInteractive(bool)  // hides the handles and stops grabbing the pointer (e.g. while painting)
 *   MaskEditor.guessShape(points) -> {kind,cx,cy,w,h} | null     // "Looks like a circle" for brush loops
 *
 * onChange(phase): 'live' while a handle is being dragged, 'commit' when it is released / a button was used.
 */
(function () {
  var NS = "http://www.w3.org/2000/svg", PI = Math.PI;
  function el(name, attrs, parent) { var e = document.createElementNS(NS, name); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function noop() {}

  var HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  var CURSORS = { "-1,-1": "nwse-resize", "0,-1": "ns-resize", "1,-1": "nesw-resize", "1,0": "ew-resize", "1,1": "nwse-resize", "0,1": "ns-resize", "-1,1": "nesw-resize", "-1,0": "ew-resize" };

  function MaskEditor(o) {
    this.frame = o.frame; this.W = o.w; this.H = o.h;
    this.objects = []; this.sel = null; this.nextId = 1; this.interactive = true;
    this.onChange = o.onChange || noop; this.onSelect = o.onSelect || noop;
    var svg = this.svg = el("svg", { "class": "medit", viewBox: "0 0 " + this.W + " " + this.H, preserveAspectRatio: "none" });
    svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:6");
    this.frame.appendChild(svg);
    this.gS = el("g", {}, svg); this.gH = el("g", {}, svg);
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.render(); }).observe(this.frame);
    // clicking anywhere that is not a shape or a handle deselects
    this.frame.addEventListener("pointerdown", function (e) { if (!self.interactive) return; if (!(e.target.closest && e.target.closest("[data-obj]"))) self.select(null); }, true);
    document.addEventListener("keydown", function (e) {
      if (!self.interactive || self.sel == null) return;
      var t = e.target; if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      var o = self.get(self.sel); if (!o) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); self.remove(o.id); return; }
      var step = e.shiftKey ? 10 : 1, dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step; else if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step; else return;
      e.preventDefault(); o.cx += dx / self.W; o.cy += dy / self.H; self.render(); self.onChange("commit");
    });
  }

  /* ---------- geometry ---------- */
  MaskEditor.prototype._toLocal = function (o, px, py) { var t = -o.rot * PI / 180, dx = px - o.cx * this.W, dy = py - o.cy * this.H; return [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)]; };
  MaskEditor.prototype._toWorld = function (o, lx, ly) { var t = o.rot * PI / 180; return [o.cx * this.W + lx * Math.cos(t) - ly * Math.sin(t), o.cy * this.H + lx * Math.sin(t) + ly * Math.cos(t)]; };
  MaskEditor.prototype._pt = function (e) { var r = this.svg.getBoundingClientRect(); return [(e.clientX - r.left) * this.W / r.width, (e.clientY - r.top) * this.H / r.height]; };
  MaskEditor.prototype._k = function () { return this.W / Math.max(1, this.frame.clientWidth); }; // working px per CSS px

  /* ---------- model ---------- */
  MaskEditor.prototype.get = function (id) { for (var i = 0; i < this.objects.length; i++) if (this.objects[i].id === id) return this.objects[i]; return null; };
  MaskEditor.prototype.add = function (spec) {
    var size = 0.3, o = Object.assign({ id: this.nextId++, kind: "ellipse", cx: 0.5, cy: 0.5, w: size, h: size * this.W / this.H, rot: 0, mode: "add" }, spec || {});
    if (!o.name) { var n = this.objects.filter(function (x) { return x.kind === o.kind && !x.poly === !o.poly; }).length + 1; o.name = (o.kind === "poly" ? "Shape" : o.kind === "rect" ? "Rectangle" : "Ellipse") + " " + n; }
    if (o.kind === "poly" && o.poly) o._bits = null;
    this.objects.push(o); this.sel = o.id; this.render(); this.onSelect(o); this.onChange("commit"); return o;
  };
  MaskEditor.prototype.update = function (id, patch, phase) { var o = this.get(id); if (!o) return; Object.assign(o, patch); this.render(); this.onChange(phase || "live"); };
  MaskEditor.prototype.remove = function (id) { this.objects = this.objects.filter(function (o) { return o.id !== id; }); if (this.sel === id) { this.sel = null; this.onSelect(null); } this.render(); this.onChange("commit"); };
  MaskEditor.prototype.duplicate = function (id) { var o = this.get(id); if (!o) return; var c = Object.assign({}, o, { id: this.nextId++, cx: Math.min(0.95, o.cx + 0.04), cy: Math.min(0.95, o.cy + 0.06), name: o.name + " copy" }); c._bits = null; this.objects.push(c); this.sel = c.id; this.render(); this.onSelect(c); this.onChange("commit"); };
  MaskEditor.prototype.clear = function () { this.objects = []; this.sel = null; this.render(); this.onSelect(null); this.onChange("commit"); };
  MaskEditor.prototype.select = function (id) { if (this.sel === id) return; this.sel = id; this.render(); this.onSelect(id == null ? null : this.get(id)); };
  MaskEditor.prototype.setInteractive = function (b) { this.interactive = b; this.svg.style.opacity = b ? 1 : 0.55; this.render(); };
  MaskEditor.prototype.toJSON = function () { return this.objects.map(function (o) { return { kind: o.kind, name: o.name, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rot: o.rot, mode: o.mode, poly: o.poly || null }; }); };
  MaskEditor.prototype.fromJSON = function (arr) { var self = this; this.objects = []; this.sel = null; (arr || []).forEach(function (s) { self.objects.push(Object.assign({ id: self.nextId++ }, s)); }); this.render(); this.onSelect(null); };

  /* ---------- rasterise into the engine's mask ---------- */
  MaskEditor.prototype.rasterize = function (out) {
    var W = this.W, H = this.H, M = 72, self = this;
    this.objects.forEach(function (o) {
      var hw = o.w * W / 2, hh = o.h * H / 2, t = o.rot * PI / 180, ct = Math.cos(t), st = Math.sin(t);
      var ex = Math.abs(hw * ct) + Math.abs(hh * st), ey = Math.abs(hw * st) + Math.abs(hh * ct), cx = o.cx * W, cy = o.cy * H;
      var x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(W - 1, Math.ceil(cx + ex)), y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(H - 1, Math.ceil(cy + ey));
      if (o.kind === "poly" && !o._bits) o._bits = window.Regions.polyBits(o.poly, M);
      var v = o.mode === "cut" ? 0 : 1;
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy, lx = dx * ct + dy * st, ly = -dx * st + dy * ct, u = lx / hw, w = ly / hh, inside;
        if (o.kind === "ellipse") inside = u * u + w * w <= 1;
        else if (o.kind === "rect") inside = Math.abs(u) <= 1 && Math.abs(w) <= 1;
        else { var bx = (u + 1) / 2, by = (w + 1) / 2; inside = bx >= 0 && bx < 1 && by >= 0 && by < 1 && o._bits[Math.floor(by * M) * M + Math.floor(bx * M)] === 1; }
        if (inside) out[y * W + x] = v;
      }
    });
    return out;
  };

  /* ---------- drawing: outlines + handles in an SVG layer (crisp at any zoom) ---------- */
  MaskEditor.prototype._shapeEl = function (o, parent) {
    var hw = o.w * this.W / 2, hh = o.h * this.H / 2, cut = o.mode === "cut";
    var g = el("g", { transform: "translate(" + o.cx * this.W + " " + o.cy * this.H + ") rotate(" + o.rot + ")", "data-obj": o.id }, parent);
    var common = { fill: cut ? "rgba(10,9,8,.001)" : "rgba(255,90,54,.001)", stroke: o.id === this.sel ? "#ece4d3" : "rgba(236,228,211,.7)", "stroke-width": o.id === this.sel ? 1.6 : 1.2, "stroke-dasharray": cut ? "5 4" : "", "vector-effect": "non-scaling-stroke", "data-obj": o.id };
    var shape;
    if (o.kind === "ellipse") shape = el("ellipse", Object.assign({ rx: hw, ry: hh }, common), g);
    else if (o.kind === "rect") shape = el("rect", Object.assign({ x: -hw, y: -hh, width: hw * 2, height: hh * 2 }, common), g);
    else shape = el("path", Object.assign({ d: o.poly.map(function (p, i) { return (i ? "L" : "M") + ((p[0] - 0.5) * 2 * hw).toFixed(2) + " " + ((p[1] - 0.5) * 2 * hh).toFixed(2); }).join("") + "Z" }, common), g);
    shape.style.pointerEvents = this.interactive ? "all" : "none"; shape.style.cursor = "move";
    var self = this;
    shape.addEventListener("pointerdown", function (e) { if (!self.interactive) return; e.stopPropagation(); e.preventDefault(); self.select(o.id); self._drag(e, o, "move"); });
    return g;
  };
  MaskEditor.prototype.render = function () {
    var self = this, k = this._k();
    this.gS.textContent = ""; this.gH.textContent = "";
    this.objects.forEach(function (o) { self._shapeEl(o, self.gS); });
    var o = this.get(this.sel); if (!o || !this.interactive) return;
    var hw = o.w * this.W / 2, hh = o.h * this.H / 2, hs = 5.5 * k;
    var g = el("g", { transform: "translate(" + o.cx * this.W + " " + o.cy * this.H + ") rotate(" + o.rot + ")", "data-obj": o.id }, this.gH);
    el("rect", { x: -hw, y: -hh, width: hw * 2, height: hh * 2, fill: "none", stroke: "rgba(236,228,211,.45)", "stroke-width": 1, "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke", "data-obj": o.id, style: "pointer-events:none" }, g);
    el("line", { x1: 0, y1: -hh, x2: 0, y2: -hh - 20 * k, stroke: "rgba(236,228,211,.6)", "stroke-width": 1, "vector-effect": "non-scaling-stroke", style: "pointer-events:none" }, g);
    var rot = el("circle", { cx: 0, cy: -hh - 20 * k, r: hs * 1.15, fill: "#ff5a36", stroke: "#0a0908", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-obj": o.id, style: "cursor:grab;pointer-events:all" }, g);
    rot.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); self._drag(e, o, "rotate"); });
    HANDLES.forEach(function (h) {
      var r = el("rect", { x: h[0] * hw - hs, y: h[1] * hh - hs, width: hs * 2, height: hs * 2, rx: hs * 0.35, fill: "#ece4d3", stroke: "#0a0908", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-obj": o.id, style: "cursor:" + CURSORS[h.join(",")] + ";pointer-events:all" }, g);
      r.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); self._drag(e, o, "resize", h); });
    });
  };

  /* ---------- dragging ---------- */
  MaskEditor.prototype._drag = function (e, o, type, h) {
    var self = this, W = this.W, H = this.H, start = Object.assign({}, o), p0 = this._pt(e), moved = false;
    function move(ev) {
      var p = self._pt(ev); moved = true;
      if (type === "move") { o.cx = Math.max(0, Math.min(1, start.cx + (p[0] - p0[0]) / W)); o.cy = Math.max(0, Math.min(1, start.cy + (p[1] - p0[1]) / H)); }
      else if (type === "rotate") { var a = Math.atan2(p[1] - start.cy * H, p[0] - start.cx * W) * 180 / PI + 90; if (ev.shiftKey) a = Math.round(a / 15) * 15; o.rot = ((Math.round(a) % 360) + 360) % 360; }
      else {
        var l = self._toLocal(start, p[0], p[1]), hw = start.w * W / 2, hh = start.h * H / 2, min = 6;
        var ax = h[0] ? -h[0] * hw : 0, ay = h[1] ? -h[1] * hh : 0;
        var nw = h[0] ? Math.max(min, Math.abs(l[0] - ax)) : hw * 2, nh = h[1] ? Math.max(min, Math.abs(l[1] - ay)) : hh * 2;
        if ((ev.shiftKey || start.kind === "poly") && h[0] && h[1]) { var s = Math.max(nw / (hw * 2), nh / (hh * 2)); nw = hw * 2 * s; nh = hh * 2 * s; }
        var cxl = h[0] ? ax + h[0] * nw / 2 : 0, cyl = h[1] ? ay + h[1] * nh / 2 : 0, wp = self._toWorld(start, cxl, cyl);
        o.cx = wp[0] / W; o.cy = wp[1] / H; o.w = nw / W; o.h = nh / H;
      }
      self.render(); self.onChange("live");
    }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (moved) self.onChange("commit"); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  /* ---------- "Looks like a circle" for a drawn loop (replaces OpenCV in the old plan) ---------- */
  MaskEditor.guessShape = function (pts, W, H) {
    if (!pts || pts.length < 14) return null;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var a = (x1 - x0) / 2, b = (y1 - y0) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (a < 14 || b < 14) return null;
    var f = pts[0], l = pts[pts.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) > Math.max(a, b) * 0.7) return null; // not a closed loop
    var ed = 0, rd = 0;
    pts.forEach(function (p) { var e = Math.pow((p[0] - cx) / a, 2) + Math.pow((p[1] - cy) / b, 2); ed += Math.abs(Math.sqrt(e) - 1); rd += Math.min(Math.min(p[0] - x0, x1 - p[0]) / a, Math.min(p[1] - y0, y1 - p[1]) / b); });
    ed /= pts.length; rd /= pts.length;
    var kind = ed < 0.2 ? "ellipse" : rd < 0.16 ? "rect" : null;
    if (!kind) return null;
    return { kind: kind, cx: cx / W, cy: cy / H, w: (a * 2) / W, h: (b * 2) / H, label: kind === "ellipse" ? (Math.abs(a - b) < a * 0.15 ? "circle" : "ellipse") : "rectangle" };
  };

  window.MaskEditor = MaskEditor;
})();
