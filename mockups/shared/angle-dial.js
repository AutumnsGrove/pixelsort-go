/*
 * Free-form angle dial for the mockups. Any angle 0-359 (integers), drag anywhere on the dial.
 *   Shift (or opts.snap) snaps to 15deg. Arrow keys nudge by 1deg (Shift = 15deg) when focused.
 *   0deg points right and the angle grows counter-clockwise on screen, matching PixelDemo.
 *
 * Theme it from CSS with custom properties on the host or any ancestor:
 *   --ad-ring  --ad-tick  --ad-tick-major  --ad-arm  --ad-knob  --ad-num  --ad-label  --ad-font
 */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var CSS = ".ad{width:100%;height:100%;display:block;touch-action:none;cursor:pointer;outline:none;user-select:none;-webkit-user-select:none}" +
    ".ad-ring{fill:var(--ad-fill,none);stroke:var(--ad-ring,#555);stroke-width:1.5}" +
    ".ad-tick{stroke:var(--ad-tick,#555);stroke-width:1}" +
    ".ad-tick.major{stroke:var(--ad-tick-major,#999);stroke-width:1.6}" +
    ".ad-arm{stroke:var(--ad-arm,#fff);stroke-width:3.5;stroke-linecap:round}" +
    ".ad-head{fill:var(--ad-arm,#fff)}" +
    ".ad-knob{fill:var(--ad-knob,#fff);stroke:var(--ad-knob-ring,rgba(0,0,0,.5));stroke-width:3}" +
    ".ad-num{fill:var(--ad-num,#fff);font-family:var(--ad-font,inherit);font-size:var(--ad-num-size,34px);text-anchor:middle}" +
    ".ad-lbl{fill:var(--ad-label,#888);font-family:var(--ad-lfont,monospace);font-size:9px;text-anchor:middle}" +
    ".ad:focus-visible .ad-ring{stroke:var(--ad-arm,#fff)}";
  var injected = false;
  function inject() { if (injected) return; injected = true; var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); }
  function el(name, attrs, parent) { var e = document.createElementNS(NS, name); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function norm(a) { a = Math.round(a) % 360; return a < 0 ? a + 360 : a; }

  function AngleDial(host, opts) {
    inject();
    opts = opts || {};
    this.value = norm(opts.value || 0);
    this.snap = !!opts.snap; this.onInput = opts.onInput; this.onCommit = opts.onCommit; this.showNum = opts.showNum !== false;
    var svg = this.svg = el("svg", { "class": "ad", viewBox: "-16 -16 232 232", tabindex: "0", role: "slider", "aria-label": "Sort angle", "aria-valuemin": 0, "aria-valuemax": 359 });
    el("circle", { cx: 100, cy: 100, r: 86, "class": "ad-ring" }, svg);
    for (var a = 0; a < 360; a += 15) {
      var major = a % 90 === 0, mid = a % 45 === 0, r0 = major ? 70 : mid ? 75 : 79, r1 = 86, rad = a * Math.PI / 180;
      el("line", { x1: 100 + r0 * Math.cos(rad), y1: 100 - r0 * Math.sin(rad), x2: 100 + r1 * Math.cos(rad), y2: 100 - r1 * Math.sin(rad), "class": "ad-tick" + (major ? " major" : "") }, svg);
    }
    var self = this;
    [[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]].forEach(function (p) {
      var rad = p[0] * Math.PI / 180, t = el("text", { x: 100 + 100 * Math.cos(rad), y: 100 - 100 * Math.sin(rad) + 3, "class": "ad-lbl" }, svg); t.textContent = p[1];
    });
    this.arm = el("line", { x1: 100, y1: 100, x2: 150, y2: 100, "class": "ad-arm" }, svg);
    this.head = el("path", { d: "M0 0", "class": "ad-head" }, svg);
    this.knob = el("circle", { cx: 186, cy: 100, r: 9, "class": "ad-knob" }, svg);
    this.num = this.showNum ? el("text", { x: 100, y: 112, "class": "ad-num" }, svg) : null;
    host.appendChild(svg);

    function angleFrom(e) {
      var b = svg.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = -(e.clientY - (b.top + b.height / 2));
      var a = Math.atan2(dy, dx) * 180 / Math.PI;
      if (self.snap || e.shiftKey) a = Math.round(a / 15) * 15;
      return norm(a);
    }
    var dragging = false;
    svg.addEventListener("pointerdown", function (e) { dragging = true; svg.setPointerCapture(e.pointerId); svg.focus(); self._set(angleFrom(e), true); });
    svg.addEventListener("pointermove", function (e) { if (dragging) self._set(angleFrom(e), true); });
    function end() { if (!dragging) return; dragging = false; if (self.onCommit) self.onCommit(self.value); }
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
    svg.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 15 : 1, d = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -step; else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = step; else return;
      e.preventDefault(); self._set(norm(self.value + d), true); if (self.onCommit) self.onCommit(self.value);
    });
    this._render();
  }
  AngleDial.prototype._set = function (v, fire) { v = norm(v); if (v === this.value && fire) { return; } this.value = v; this._render(); if (fire && this.onInput) this.onInput(v); };
  /* set from outside without firing callbacks */
  AngleDial.prototype.set = function (v) { this.value = norm(v); this._render(); };
  AngleDial.prototype._render = function () {
    var rad = this.value * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    var tipR = 62, tx = 100 + tipR * c, ty = 100 - tipR * s;
    this.arm.setAttribute("x2", tx); this.arm.setAttribute("y2", ty);
    // direction in screen coords is (c, -s); its perpendicular is (s, c)
    var hx = 100 + (tipR + 14) * c, hy = 100 - (tipR + 14) * s, w = 8;
    this.head.setAttribute("d", "M" + hx + " " + hy + " L" + (tx + w * s) + " " + (ty + w * c) + " L" + (tx - w * s) + " " + (ty - w * c) + " Z");
    this.knob.setAttribute("cx", 100 + 86 * c); this.knob.setAttribute("cy", 100 - 86 * s);
    if (this.num) this.num.textContent = this.value + "°";
    this.svg.setAttribute("aria-valuenow", this.value);
  };
  window.AngleDial = AngleDial;
})();
