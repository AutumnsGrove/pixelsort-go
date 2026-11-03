/*
 * Settings — stored in this browser for the mockups (the real app keeps them with the rest of the user's data).
 * Pure helpers (sanitize, workCopy) plus a tiny runtime that applies look-and-feel settings to <html>, so a change
 * made on the Settings page shows on every other screen:
 *   <html data-grain="off">   hides the film grain        (PLAN.md §10: reduced motion turns grain off too)
 *   <html data-motion="reduce"> stops animation and transitions, whatever the OS says
 * Every page loads this file; it never throws if storage is unavailable.
 */
(function (root) {
  "use strict";
  const KEY = "pixelsort.mock.settings";
  const WORK_RES = [960, 1280, 1920, 2560];                 // long edge of the working copy, px (PLAN.md P3)
  const DEVICE_RES = { desktop: 1920, phone: 1280 };
  const DEFAULTS = { workRes: null, exportFormat: "png", exportQuality: 92, stripMeta: true, embedRecipe: true,
                     shareExpiry: "30", grain: true, motion: "system", speed: 24 };

  const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null; };

  /** Keep only known keys with valid values; anything else is dropped, so a corrupt store can't break a page. */
  function sanitize(o) {
    const out = {}; o = o && typeof o === "object" ? o : {};
    if ("workRes" in o && (o.workRes === null || WORK_RES.includes(o.workRes))) out.workRes = o.workRes;
    if (["png", "jpeg", "webp"].includes(o.exportFormat)) out.exportFormat = o.exportFormat;
    const q = "exportQuality" in o ? num(o.exportQuality, 40, 100) : null; if (q !== null) out.exportQuality = q;
    const sp = "speed" in o ? num(o.speed, 1, 400) : null; if (sp !== null) out.speed = sp;
    ["stripMeta", "embedRecipe", "grain"].forEach((k) => { if (typeof o[k] === "boolean") out[k] = o[k]; });
    if (["never", "30"].includes(o.shareExpiry)) out.shareExpiry = o.shareExpiry;
    if (["system", "reduce"].includes(o.motion)) out.motion = o.motion;
    return out;
  }

  /** Scale (w, h) so the long edge is at most `long`; never upscale; keep the aspect ratio. */
  function workCopy(w, h, long) {
    const k = Math.min(1, long / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: k < 1 };
  }

  let cache = null;
  function read() { try { return sanitize(JSON.parse(root.localStorage.getItem(KEY) || "{}")); } catch (e) { return {}; } }
  function get() { if (!cache) cache = Object.assign({}, DEFAULTS, read()); return Object.assign({}, cache); }
  function set(patch) {
    const clean = sanitize(patch); cache = Object.assign({}, get(), clean);
    try { root.localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* private mode: keep it for this page */ }
    apply(); return get();
  }
  function reset() { cache = Object.assign({}, DEFAULTS); try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } apply(); return get(); }
  const workRes = (device) => get().workRes || DEVICE_RES[device] || DEVICE_RES.desktop;

  function apply() {
    if (typeof document === "undefined") return;
    const s = get(), h = document.documentElement;
    h.dataset.grain = s.grain ? "on" : "off";
    if (s.motion === "reduce") h.dataset.motion = "reduce"; else delete h.dataset.motion;
    if (!document.getElementById("st-settings-css")) {
      const st = document.createElement("style"); st.id = "st-settings-css";
      st.textContent = 'html[data-grain="off"] .grain{display:none!important}' +
        'html[data-motion="reduce"] *,html[data-motion="reduce"] *::before,html[data-motion="reduce"] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}';
      document.head.appendChild(st);
    }
  }

  const api = { KEY, DEFAULTS, WORK_RES, DEVICE_RES, sanitize, workCopy, get, set, reset, workRes, apply };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else { root.Settings = api; if (root.document) apply(); }
})(typeof self !== "undefined" ? self : this);
