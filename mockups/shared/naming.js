/*
 * Naming — give a piece a name where you are looking at it. The name is what the filmstrip, the Archive, search and
 * the exported filename all use, so one place decides what a valid name is and what happens when you clear it.
 *
 *   Naming.clean(text)                 pure: tidy what was typed (control characters out, spaces collapsed, 60 long)
 *   Naming.suggest(params, seed)       pure: the automatic name, "Ridge, threshold"; also what clearing the field gives back
 *   Naming.resolve(typed, fallback)    pure: { name, kept, cleared } — empty never saves an empty name
 *   Naming.fileName(name, recipe, fmt) pure: what the export will be called (same slug rules as the export dialog)
 *   Naming.store                       names you chose, by run id, in this browser (the real app: PATCH /api/runs/:id)
 *   Naming.attach(el, opts)            turn a caption into "click or tap to rename" (Enter saves, Esc undoes)
 *
 * A name is a label, not an identity: two runs may share one, and every exported file still gets its own tag.
 * The mock keeps names in localStorage under "pixelsort.mock.names".
 */
(function (root) {
  "use strict";
  const MAX = 60, KEY = "pixelsort.mock.names";
  const WORDS = ["Ridge", "Dusk", "Static", "Heat", "Curtain", "Embers", "Rain", "Skyline", "Ash", "Glass", "Tide", "Dune", "Noise", "Fall"];
  const MODE = { random: "random", wave: "waves", threshold: "threshold", edges: "edges", ca: "cellular", none: "plain" };

  const chars = (s) => Array.from(s);   // code points, so an emoji is never cut in half

  /** What you typed, made safe to keep. Line breaks and other control characters become spaces; ends are trimmed. */
  function clean(text) {
    let s = String(text == null ? "" : text).replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
    const c = chars(s); if (c.length > MAX) s = c.slice(0, MAX).join("").trim();
    return s;
  }

  const hash = (t) => { let h = 2166136261; for (const ch of String(t)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /** The automatic name: a word picked from the seed, then the mode. Stable: the same inputs always give the same name. */
  function suggest(params, seed) {
    params = params || {};
    const word = WORDS[hash(seed == null ? (params.seed != null ? params.seed : 0) : seed) % WORDS.length];
    const mode = MODE[params.mode] || String(params.mode || "random");
    return word + ", " + mode + (params.mode === "ca" && params.rule != null ? " " + params.rule : "");
  }

  /** Typed text -> the name to keep. An empty or all-spaces entry goes back to `fallback`, so a name can't be blank. */
  function resolve(typed, fallback) {
    const c = clean(typed), fb = clean(fallback) || "Untitled";
    if (!c) return { name: fb, kept: false, cleared: true };
    return { name: c, kept: true, cleared: false };
  }

  /** The slug rules of the export dialog, so the preview under the field is the real filename. */
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function fileName(name, recipe, format, tag) {
    const ext = { png: "png", jpeg: "jpg", webp: "webp" }[format] || "png";
    const nm = slug(name), rc = slug(recipe);
    return [nm || "pixelsort", rc && nm.indexOf(rc) < 0 ? rc : "", slug(tag)].filter(Boolean).join("-") + "." + ext;
  }

  /* ---- the store: { "<run id>": "name" } ------------------------------------------------------------------- */
  function sanitizeAll(o) {
    const out = {}; if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).forEach((k) => { if (/^[\w-]{1,40}$/.test(k) && typeof o[k] === "string") { const c = clean(o[k]); if (c) out[k] = c; } });
    return out;
  }
  const store = {
    all() { try { return sanitizeAll(JSON.parse(root.localStorage.getItem(KEY) || "{}")); } catch (e) { return {}; } },
    get(id) { return this.all()[String(id)] || null; },
    set(id, name) {
      const all = this.all(), c = clean(name);
      if (c) all[String(id)] = c; else delete all[String(id)];
      try { root.localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
    },
    clear() { try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
  /** Put chosen names onto a list of runs ({ id, name }); returns the same list. */
  function apply(runs) { const all = store.all(); runs.forEach((r) => { if (all[String(r.id)]) r.name = all[String(r.id)]; }); return runs; }

  /* ---- the control ----------------------------------------------------------------------------------------- */
  let styled = false;
  function css() {
    if (styled || typeof document === "undefined") return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.nm-edit{cursor:text;border-radius:6px;outline:0;transition:background .15s}
.nm-edit:hover{background:rgba(255,255,255,.05)}
.nm-edit:focus-visible{box-shadow:0 0 0 2px var(--gold)}
.nm-tall{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;margin:0 -6px}
.nm-tall[hidden]{display:none}
.caption:has(.nm-box),.cap:has(.nm-box){bottom:auto;top:calc(100% + 10px);right:auto;white-space:normal;overflow:visible;max-width:calc(100vw - 24px)}
.nm-edit::after{content:"\\270E";font-family:var(--mono);font-style:normal;font-size:.72em;margin-left:.5em;opacity:0;transition:opacity .15s}
.nm-edit:hover::after,.nm-edit:focus-visible::after{opacity:.55}
@media (hover:none){.nm-edit::after{opacity:.4}}
.nm-box{display:inline-flex;flex-direction:column;gap:5px;max-width:100%;vertical-align:top;font-style:normal}
.nm-row{display:flex;align-items:center;gap:8px;max-width:100%}
.nm-in{font:inherit;font-style:italic;color:var(--paper);background:rgba(255,255,255,.07);border:1px solid var(--gold);border-radius:8px;padding:2px 8px;min-width:12ch;width:26ch;max-width:100%;outline:0;min-height:var(--nm-h,0)}
.nm-ok,.nm-reset{font-family:var(--mono);font-style:normal;font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:var(--dim);padding:4px 8px;border-radius:999px;border:1px solid var(--faint);white-space:nowrap;min-height:var(--nm-h,0)}
.nm-ok{color:var(--paper)}.nm-ok:hover,.nm-reset:hover{border-color:var(--dim)}
.nm-hint{font-family:var(--mono);font-style:normal;font-size:9.5px;letter-spacing:.7px;color:var(--dim);line-height:1.5;white-space:normal;max-width:min(46ch,100%)}
.nm-hint b{color:var(--paper);font-weight:500}
`;
    document.head.appendChild(s);
  }

  /**
   * opts: { get() -> name, set(name), fallback() -> automatic name, label, tall, onStart(), onEnd(),
   *         preview(name) -> file name shown while editing, shortcut: true to also bind F2 on window }
   * Returns { start(), cancel(), editing() }.
   */
  function attach(el, opts) {
    css(); opts = opts || {};
    el.classList.add("nm-edit"); el.tabIndex = 0; el.setAttribute("role", "button");
    el.setAttribute("aria-label", (opts.label || "Name") + ": " + opts.get() + ". Press Enter to rename.");
    el.title = "Click to rename";
    if (opts.tall) el.classList.add("nm-tall");
    let box = null, shown = null;

    function show() { el.textContent = opts.get(); el.hidden = false; el.setAttribute("aria-label", (opts.label || "Name") + ": " + opts.get() + ". Press Enter to rename."); }
    function close(save, commitText) {
      if (!box) return;
      const wasBox = box; box = null;
      if (save) {
        const r = resolve(commitText, opts.fallback ? opts.fallback() : opts.get());
        if (r.name !== opts.get()) opts.set(r.name, r);
      }
      wasBox.remove(); show(); if (opts.onEnd) opts.onEnd(); el.focus({ preventScroll: true });
    }
    function start() {
      if (box) return; if (opts.onStart) opts.onStart();
      const cur = opts.get(); el.hidden = true;
      box = document.createElement("div"); box.className = "nm-box"; if (opts.tall) box.style.setProperty("--nm-h", "44px");
      box.innerHTML = '<div class="nm-row"><input class="nm-in" type="text" maxlength="' + (MAX * 2) + '" spellcheck="false" autocomplete="off" aria-label="' + (opts.label || "Name") + '"><button class="nm-ok" type="button">Save</button>' +
        (opts.fallback ? '<button class="nm-reset" type="button" title="Go back to the automatic name">Auto</button>' : "") + '</div><div class="nm-hint"></div>';
      el.after(box);
      const input = box.querySelector("input"), hint = box.querySelector(".nm-hint");
      input.value = cur;
      const sync = () => {
        const c = clean(input.value), n = chars(c).length, over = chars(input.value.replace(/\s+/g, " ").trim()).length > MAX;
        hint.innerHTML = (c ? (opts.preview ? "Saves as <b>" + opts.preview(c).replace(/[<>&]/g, "") + "</b>" : "") : "Empty goes back to <b>" + (opts.fallback ? opts.fallback() : cur).replace(/[<>&]/g, "") + "</b>") +
          (n >= MAX - 10 ? " · " + n + "/" + MAX + (over ? " (shortened)" : "") : "");
      };
      input.addEventListener("input", sync); sync();
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); close(true, input.value); } else if (e.key === "Escape") { e.preventDefault(); close(false); } });
      box.querySelector(".nm-ok").onclick = () => close(true, input.value);
      const rs = box.querySelector(".nm-reset"); if (rs) rs.onclick = () => { input.value = ""; close(true, ""); };
      // Leaving the field saves, unless focus only moved to this box's own buttons.
      box.addEventListener("focusout", (e) => { if (box && !box.contains(e.relatedTarget)) setTimeout(() => { if (box && !box.contains(document.activeElement)) close(true, input.value); }, 0); });
      input.focus(); input.select();
    }
    el.addEventListener("click", start);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } });
    show();
    return { start, cancel: () => close(false), editing: () => !!box, refresh: show };
  }

  const api = { MAX, KEY, clean, suggest, resolve, slug, fileName, store, apply, sanitizeAll, attach };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Naming = api;
})(typeof self !== "undefined" ? self : this);
