/*
 * Errors — one catalog, so every failure says three things: what happened, what is still safe, and what to do next.
 * Never a raw exception: the technical detail lives behind "Details" (with Copy) for when you need to report it.
 *
 *   ErrorSheet.describe(code, ctx)                     pure: { code, tone, title, body, safe, actions:[{id,label,primary}] }
 *   ErrorSheet.show({ host, code, ctx, detail, onAction, modal })
 *       modal (default true): a dialog that waits for you. modal:false: a banner for background failures
 *       (saving a run, making a link) that must never stop you working.
 *
 * Mockup triggers: ?error=engine|crash|save · a link containing "blocked", "notimage", "huge" or "slow" ·
 * a text file dropped as a picture · ?maxmp=0.001 for "too big" · "Fail at band 3" in the export dialog · ?error=share.
 */
(function (root) {
  "use strict";
  const mb = (n) => (typeof n === "number" && isFinite(n) ? (n >= 10 ? Math.round(n) : n.toFixed(1)) + " MB" : "a lot");
  const mp = (n) => (typeof n === "number" && isFinite(n) ? (n >= 10 ? Math.round(n) : n.toFixed(1)) + " MP" : "a very large picture");

  // Each entry is a function of ctx so missing fields degrade to plain words, never "undefined".
  const CATALOG = {
    "image-unreadable": (c) => ({ tone: "warn", title: "That isn’t a picture I can read.",
      body: (c.name ? "“" + c.name + "” " : "That file ") + "doesn’t open as an image. It may be damaged, or not an image at all.",
      safe: "Your current picture and settings are untouched.", actions: [{ id: "choose", label: "Choose another", primary: true }, { id: "close", label: "Keep what I have" }] }),
    "image-too-big": (c) => ({ tone: "warn", title: "That picture is too large to open here.",
      body: "It is " + mp(c.mp) + "; this " + (c.device || "device") + " can open up to " + mp(c.max) + ". Opening it would run the browser out of memory.",
      safe: "Nothing was changed.", actions: [{ id: "choose", label: "Choose a smaller one", primary: true }, { id: "close", label: "Cancel" }] }),
    "link-blocked": () => ({ tone: "warn", title: "That site won’t let me fetch the picture.",
      body: "The site blocks direct loads, and the relay couldn’t get it either. Some sites refuse anything that isn’t a browser tab.",
      safe: "Nothing was loaded and nothing left your network.", actions: [{ id: "save-and-drop", label: "Save it, then drop the file here", primary: true }, { id: "close", label: "Close" }] }),
    "link-not-image": (c) => ({ tone: "warn", title: "That link isn’t a picture.",
      body: "It opened a " + (c.kind || "web page") + ", not an image. Try the picture’s own address (right-click it, then copy image address).",
      safe: "Nothing was loaded.", actions: [{ id: "retry", label: "Try another link", primary: true }, { id: "close", label: "Close" }] }),
    "link-too-large": (c) => ({ tone: "warn", title: "That picture is bigger than the relay allows.",
      body: "It is about " + mb(c.mb) + "; the relay stops at " + mb(c.max || 40) + ". Pictures loaded straight from a site have no such limit — so downloading it and dropping the file in will work.",
      safe: "Nothing was loaded.", actions: [{ id: "save-and-drop", label: "Download it, then drop the file", primary: true }, { id: "close", label: "Close" }] }),
    "link-timeout": () => ({ tone: "warn", title: "The site took too long to answer.",
      body: "The relay waited 15 seconds. The site may be slow or down.", safe: "Nothing was loaded.", actions: [{ id: "retry", label: "Try again", primary: true }, { id: "close", label: "Close" }] }),
    "engine-failed": () => ({ tone: "error", title: "The sorting engine didn’t start.",
      body: "The part that does the sorting couldn’t load. This is usually a flaky connection, or a browser that is too old to run it.",
      safe: "Your pictures, runs and settings are fine — only the sorter is missing.", actions: [{ id: "retry", label: "Try again", primary: true }, { id: "reload", label: "Reload the page" }] }),
    "engine-crashed": () => ({ tone: "error", title: "The sorter stopped unexpectedly.",
      body: "It hit a problem partway through and was shut down so it couldn’t take the page with it.",
      safe: "Your picture and every setting are still here.", actions: [{ id: "restart", label: "Restart the sorter", primary: true }, { id: "close", label: "Close" }] }),
    "export-oom": (c) => ({ tone: "error", title: "The export ran out of memory.",
      body: "It stopped at band " + (c.band || "?") + " of " + (c.bands || "?") + " when this " + (c.device || "device") + " couldn’t hold any more." + (c.size ? " " + c.size + " was too much." : ""),
      safe: "Your run is saved in the Archive; nothing was written to disk.", actions: [{ id: "smaller", label: c.scale ? "Export at " + Math.round(c.scale * 100) + "% instead" : "Export smaller", primary: true }, { id: "back", label: "Back to options" }] }),
    "save-failed": (c) => ({ tone: "warn", title: "Couldn’t save this run to the Archive.",
      body: c.reason === "disk" ? "The server says its disk is full." : "The server didn’t accept it" + (c.reason === "timeout" ? " in time." : "."),
      safe: "Keep working — the run is kept here and will be sent again. Exporting still works.", actions: [{ id: "retry", label: "Retry now", primary: true }, { id: "close", label: "Dismiss" }] }),
    "share-failed": (c) => ({ tone: "warn", title: "Couldn’t make the link.",
      body: c.reason === "quota" ? "The shared bucket is full. Revoke an old album to make room." : "Your Worker didn’t answer, so nothing was uploaded.",
      safe: "Nothing was shared and your runs are untouched.", actions: [{ id: "retry", label: "Try again", primary: true }, { id: "close", label: "Close" }] }),
  };
  const FALLBACK = () => ({ tone: "error", title: "Something went wrong.", body: "That didn’t work, and I don’t have a specific reason to give you.", safe: "Your picture and settings are untouched.", actions: [{ id: "close", label: "Close", primary: true }] });

  function describe(code, ctx) {
    const make = CATALOG[code] || FALLBACK, d = make(ctx || {});
    return Object.assign({ code: CATALOG[code] ? code : "unknown" }, d);
  }

  let styled = false;
  function css() {
    if (styled) return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.er{position:absolute;inset:0;z-index:150;display:grid;place-items:center;padding:20px;background:rgba(8,7,6,.8);backdrop-filter:blur(10px);animation:erin .25s var(--ease) both}
.er.er-fixed{position:fixed}
@keyframes erin{from{opacity:0}to{opacity:1}}
.er-card{width:min(500px,100%);padding:26px 28px 22px;animation:erup .35s var(--ease) both}
@keyframes erup{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
.er-mark{width:10px;height:10px;border-radius:50%;background:var(--gold);display:inline-block;margin-right:9px;vertical-align:1px}
.er-error .er-mark{background:var(--ver);box-shadow:0 0 10px var(--ver)}
.er-card h3{font-family:var(--serif);font-style:italic;font-weight:400;font-size:32px;line-height:1.05;margin:10px 0 10px}
.er-card p{color:var(--dim);font-size:11.5px;line-height:1.75}
.er-card p.safe{color:var(--paper);margin-top:10px;padding-left:12px;border-left:2px solid var(--ok)}
.er-det{margin-top:14px}
.er-det summary{cursor:pointer;color:var(--dim);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;list-style:none}
.er-det summary:hover{color:var(--paper)}
.er-det pre{margin:8px 0 0;padding:10px 12px;border:1px solid var(--faint);border-radius:12px;font-family:var(--mono);font-size:10px;line-height:1.6;color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto}
.er-foot{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px}
.er-foot .btn{min-height:44px}
.erb{position:absolute;left:50%;bottom:104px;transform:translateX(-50%);z-index:58;display:flex;align-items:center;gap:14px;max-width:min(640px,calc(100% - 24px));padding:10px 10px 10px 18px;border-radius:22px;background:rgba(24,20,18,.96);border:1px solid rgba(232,184,106,.4);backdrop-filter:blur(12px);box-shadow:0 14px 40px rgba(0,0,0,.55);animation:erbin .4s var(--ease) both}
.erb.er-fixed{position:fixed}
@keyframes erbin{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.erb span{min-width:0;font-size:11px;line-height:1.5;color:var(--dim)}
.erb b{display:block;font-family:var(--serif);font-style:italic;font-weight:400;font-size:18px;color:var(--paper)}
.erb button{flex:none;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;border:1px solid var(--faint);border-radius:999px;padding:0 14px;min-height:44px;transition:.15s}
.erb button:hover{border-color:var(--dim);background:var(--faint2)}
.erb button.p{color:var(--gold);border-color:rgba(232,184,106,.45)}
`;
    document.head.appendChild(s);
  }

  function show(o) {
    css();
    const host = o.host || document.body, d = describe(o.code, o.ctx), modal = o.modal !== false, fixed = host === document.body ? " er-fixed" : "";
    const el = document.createElement("div"), prev = document.activeElement;
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    function done(id) { document.removeEventListener("keydown", onKey, true); el.remove(); if (modal && prev && prev.focus) try { prev.focus(); } catch (e) { /* ignore */ } if (o.onAction) o.onAction(id, d); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); done("close"); } }
    if (modal) {
      el.className = "er er-" + d.tone + fixed; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "erT"); el.dataset.code = d.code;
      el.innerHTML = `<div class="er-card glass"><div class="eyebrow"><i class="er-mark"></i>${d.tone === "error" ? "Something broke" : "Couldn’t do that"}</div><h3 id="erT">${esc(d.title)}</h3><p>${esc(d.body)}</p><p class="safe">${esc(d.safe)}</p>` +
        (o.detail ? `<details class="er-det"><summary>Details</summary><pre>${esc(o.detail)}</pre><button class="btn sm" data-copy style="margin-top:8px">Copy</button></details>` : "") +
        `<div class="er-foot">${d.actions.map((a) => `<button class="btn${a.primary ? " pri" : ""}" data-a="${a.id}">${esc(a.label)}</button>`).join("")}</div></div>`;
    } else {
      el.className = "erb er-" + d.tone + fixed; el.setAttribute("role", "status"); el.dataset.code = d.code;
      const p = d.actions.find((a) => a.primary), q = d.actions.find((a) => !a.primary);
      el.innerHTML = `<span><b>${esc(d.title)}</b>${esc(d.body)} ${esc(d.safe)}</span>${p ? `<button class="p" data-a="${p.id}">${esc(p.label)}</button>` : ""}${q ? `<button data-a="${q.id}">${esc(q.label)}</button>` : ""}`;
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]"); if (b) { done(b.dataset.a); return; }
      const cp = e.target.closest("[data-copy]");
      if (cp) {
        /* only claim success when the browser agreed; otherwise select the text so ⌘C / Ctrl+C works */
        const manual = () => { const pre = el.querySelector("pre"), r = document.createRange(); r.selectNodeContents(pre); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); cp.textContent = "Press ⌘C / Ctrl+C"; };
        let p; try { p = navigator.clipboard.writeText(o.detail); } catch (err) { manual(); return; }
        Promise.resolve(p).then(() => { cp.textContent = "Copied"; }, manual);
      }
    });
    host.appendChild(el);
    if (modal) { document.addEventListener("keydown", onKey, true); const pb = el.querySelector(".pri") || el.querySelector("[data-a]"); if (pb) pb.focus(); }
    return { close: () => done("close"), el, d };
  }

  const api = { CATALOG, describe, show };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ErrorSheet = api;
})(typeof self !== "undefined" ? self : this);
