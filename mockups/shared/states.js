/*
 * App states that are not "everything is fine": storage near or over the budget, and the server being out of
 * reach. One place decides what each screen says, so Studio, the phone and the Archive never word it differently.
 *
 *   PLAN.md §6: the meter warns at 80 %; at 100 % new runs still save but the warning is loud; nothing is ever
 *   auto-deleted. The browser does all the sorting, so "offline" only breaks what touches the server.
 *
 * Mockup switches: ?used=40 (GB) · ?offline · ?empty. The real app reads GET /api/usage and navigator.onLine.
 */
(function (root) {
  "use strict";
  const BUDGET_GB = 50, WARN_AT = 0.8;

  const usage = (used, budget) => {
    budget = budget || BUDGET_GB;
    const frac = used / budget;
    return { used, budget, frac, pct: Math.floor(frac * 100 + 1e-9), level: frac >= 1 ? "full" : frac >= WARN_AT ? "warn" : "ok" };
  };

  function fromQuery(search) {
    const m = /[?&]used=([\d.]+)/.exec(search || "");
    return { used: m ? +m[1] : null, offline: /[?&]offline\b/.test(search || ""), empty: /[?&]empty\b/.test(search || "") };
  }

  /**
   * What to tell the person, or null when all is well. Offline outranks storage: it is the one that stops work.
   * surface: "studio" (a pill over the picture) | "archive" (a banner above the grid).
   */
  function status(state, o) {
    o = o || {};
    const u = usage(state.used == null ? 0 : state.used), g = (n) => n.toFixed(1);
    if (state.offline) {
      return o.surface === "archive"
        ? { kind: "offline", text: "Can’t reach your server.", sub: "Showing what this browser kept. Looking is fine; saving, sending and deleting wait until it’s back.", action: "Retry" }
        : { kind: "offline", text: "Offline — sorting still works.", sub: (o.pending || 0) + " run" + (o.pending === 1 ? "" : "s") + " will save when the server is back.", action: "Retry" };
    }
    if (u.level === "full") return { kind: "full", text: "The Archive is full — " + g(u.used) + " of " + u.budget + " GB.", sub: "New runs still save and nothing is deleted. Free up some space when you can.", action: "Free up space" };
    if (u.level === "warn") return { kind: "warn", text: "The Archive is " + u.pct + "% full — " + g(u.used) + " of " + u.budget + " GB.", sub: "Nothing is deleted automatically.", action: "Free up space" };
    return null;
  }

  /** Meter segments (GB) for a given total: results, originals, thumbs, bin. Sums to `used`. */
  function segments(used, binGB) {
    binGB = Math.min(binGB == null ? 1.4 : binGB, used);
    const rest = used - binGB, thumbs = rest * 0.04, originals = rest * 0.2;
    return { results: rest - thumbs - originals, originals, thumbs, bin: binGB };
  }

  let styled = false;
  function css() {
    if (styled) return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.st-pill{position:absolute;left:50%;top:72px;transform:translateX(-50%);z-index:56;display:flex;align-items:center;gap:14px;max-width:min(720px,calc(100% - 24px));padding:9px 10px 9px 18px;border-radius:999px;background:rgba(24,20,18,.92);border:1px solid var(--faint);backdrop-filter:blur(14px);box-shadow:0 14px 40px rgba(0,0,0,.55);animation:stin .4s var(--ease) both}
@keyframes stin{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
.st-pill i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--gold)}
.st-pill.offline i{background:var(--dim)}.st-pill.full i{background:var(--ver);box-shadow:0 0 10px var(--ver)}
.st-pill.full{border-color:rgba(255,90,54,.45)}
.st-pill span{min-width:0;font-size:11.5px;line-height:1.45}
.st-pill b{font-family:var(--serif);font-style:italic;font-weight:400;font-size:17px;display:block;line-height:1.15}
.st-pill small{display:block;color:var(--dim);font-size:10.5px;margin-top:1px}
.st-pill button{flex:none;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;border:1px solid var(--faint);border-radius:999px;padding:9px 14px;min-height:36px;transition:.15s}
.st-pill button:hover{border-color:var(--dim);background:var(--faint2)}
.st-pill.full button,.st-pill.warn button{color:var(--gold);border-color:rgba(232,184,106,.4)}
.st-pill .st-x{border:0;padding:9px 11px;color:var(--dim)}
.st-pill.st-compact{top:96px;width:calc(100% - 24px)}
.st-pill.st-compact small{display:none}
.st-pill.st-compact button{min-height:44px}
`;
    document.head.appendChild(s);
  }

  /**
   * Show the pill for `state` inside `host`. Reacts to the browser's real online/offline events as well as the
   * ?offline switch. Retry is a flaky server on purpose: the first try fails, the second works.
   *   opts: { host, state, pending, phone, toast, onChange(state), onAction(kind) }
   */
  function mount(opts) {
    css();
    const host = opts.host || document.body, st = opts.state, tries = { n: 0 };
    let el = null, dismissed = {};
    function paint() {
      if (el) { el.remove(); el = null; }
      const s = status(st, { surface: "studio", pending: opts.pending });
      if (!s || dismissed[s.kind]) { if (opts.onChange) opts.onChange(st, s); return; }
      el = document.createElement("div");
      el.className = "st-pill " + s.kind + (opts.phone ? " st-compact" : "");
      el.setAttribute("role", "status");
      el.innerHTML = `<i></i><span><b>${s.text}</b><small>${s.sub}</small></span><button data-a>${s.action}</button>${s.kind === "offline" ? "" : '<button class="st-x" data-x title="Dismiss">✕</button>'}`;
      host.appendChild(el);
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-x]")) { dismissed[s.kind] = true; paint(); return; }
        if (!e.target.closest("[data-a]")) return;
        if (s.kind === "offline") retry(); else if (opts.onAction) opts.onAction(s.kind);
      });
      if (opts.onChange) opts.onChange(st, s);
    }
    function retry() {
      tries.n++;
      if (typeof navigator !== "undefined" && navigator.onLine === false) { if (opts.toast) opts.toast("Still offline"); return; }
      if (tries.n < 2) { if (opts.toast) opts.toast("Still can’t reach the server"); return; }
      st.offline = false; tries.n = 0; paint();
      if (opts.toast) opts.toast("Back online — " + (opts.pending || 0) + " runs saved");
    }
    window.addEventListener("offline", () => { st.offline = true; paint(); });
    window.addEventListener("online", () => { st.offline = false; paint(); if (opts.toast) opts.toast("Back online"); });
    paint();
    return { paint, retry, state: st };
  }

  const api = { BUDGET_GB, WARN_AT, usage, fromQuery, status, segments, mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AppState = api;
})(typeof self !== "undefined" ? self : this);
