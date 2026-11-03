/*
 * Help — the keyboard-shortcut sheet and the first-run tour, shared by Studio and the phone.
 *
 * SHORTCUTS is the single source of truth: the sheet renders it, and the mockup test refuses to pass if an entry
 * has no check behind it, so the sheet can never promise a key that does nothing.
 *
 *   Help.openShortcuts({ host, onTour })
 *   Help.tour({ host, steps, onDone, startAt })   steps: [{ target: css selector, title, body, where?: "above"|"below" }]
 *
 * The tour starts by itself only with ?first in the mockups (a real first run would start it automatically);
 * auto-opening a modal here would block every test and screenshot.
 */
(function (root) {
  "use strict";
  const TOURED = "pixelsort.mock.toured";

  const SHORTCUTS = [
    { group: "Watching", items: [
      { id: "play", keys: ["Space"], what: "Play or pause" },
      { id: "restart", keys: ["R"], what: "Start over" },
      { id: "compare", keys: ["C"], what: "Hold to see the original" },
      { id: "peek", keys: ["T"], what: "Show which pixels can move" } ] },
    { group: "Making", items: [
      { id: "paint", keys: ["P"], what: "Protect brush" },
      { id: "pro", keys: ["Tab"], what: "Pro panel — shapes and masks" },
      { id: "new", keys: ["N"], what: "Bring a new picture" },
      { id: "export", keys: ["E"], what: "Export" } ] },
    { group: "Around", items: [
      { id: "runs", keys: ["G"], what: "Runs strip" },
      { id: "help", keys: ["?"], what: "This sheet" },
      { id: "esc", keys: ["Esc"], what: "Close whatever is open" } ] },
  ];
  const flat = () => SHORTCUTS.reduce((a, g) => a.concat(g.items), []);

  let styled = false;
  function css() {
    if (styled) return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.hp{position:absolute;inset:0;z-index:130;display:grid;place-items:center;padding:20px;background:rgba(8,7,6,.78);backdrop-filter:blur(10px);animation:hpin .25s var(--ease) both}
@keyframes hpin{from{opacity:0}to{opacity:1}}
.hp-card{width:min(640px,100%);max-height:100%;overflow:auto;padding:26px 28px 24px}
.hp-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.hp-head h3{font-size:34px;line-height:1;margin-top:6px}
.hp-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px 30px;margin-top:14px}
.hp-g h4{font-weight:400;font-size:10px;letter-spacing:1.7px;text-transform:uppercase;color:var(--dim);margin:12px 0 8px}
.hp-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--faint2);font-size:11.5px}
.hp-row kbd{font-family:var(--mono);font-size:11px;min-width:30px;text-align:center;padding:3px 8px;border:1px solid var(--faint);border-bottom-width:2px;border-radius:7px;color:var(--paper)}
.hp-foot{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:20px;flex-wrap:wrap}
.hp-foot a{color:var(--gold);font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;border-bottom:1px solid transparent}
.hp-foot a:hover{border-color:var(--gold)}
.hp.hp-fixed,.tr-root.hp-fixed{position:fixed}
.tr-root{position:absolute;inset:0;z-index:140}
.tr-hole{position:absolute;border-radius:16px;box-shadow:0 0 0 9999px rgba(8,7,6,.8),0 0 0 2px var(--ver),0 0 24px rgba(255,90,54,.35);transition:all .45s var(--ease);pointer-events:none}
.tr-card{position:absolute;width:min(330px,calc(100% - 24px));padding:18px 20px 14px;background:rgba(24,20,18,.97);border:1px solid var(--faint);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.65);transition:all .45s var(--ease)}
.tr-card h4{font-family:var(--serif);font-style:italic;font-weight:400;font-size:25px;line-height:1.1;margin-bottom:6px}
.tr-card p{color:var(--dim);font-size:11.5px;line-height:1.7}
.tr-foot{display:flex;align-items:center;gap:8px;margin-top:14px}
.tr-foot small{color:var(--dim);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;margin-right:auto}
.tr-foot .btn{min-height:40px;padding:0 16px}
.tr-skip{color:var(--dim);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;padding:10px 8px;min-height:40px}
.tr-skip:hover{color:var(--paper)}
`;
    document.head.appendChild(s);
  }

  function openShortcuts(o) {
    css();
    const host = o.host || document.body, el = document.createElement("div");
    el.className = "hp" + (host === document.body ? " hp-fixed" : ""); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "hpT");
    el.innerHTML = `<div class="hp-card glass"><div class="hp-head"><div><div class="eyebrow">Keyboard</div><h3 id="hpT" class="serif-i">Shortcuts</h3></div><button class="round" data-x title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
<div class="hp-cols">${SHORTCUTS.map((g) => `<div class="hp-g"><h4>${g.group}</h4>${g.items.map((i) => `<div class="hp-row" data-sc="${i.id}"><span>${i.what}</span>${i.keys.map((k) => `<kbd>${k}</kbd>`).join("")}</div>`).join("")}</div>`).join("")}</div>
<div class="hp-foot"><button class="btn" data-tour>Take the tour</button><a href="settings.html">Settings &amp; credits →</a></div></div>`;
    host.appendChild(el);
    const prev = document.activeElement;
    function close() { document.removeEventListener("keydown", onKey, true); el.remove(); if (prev && prev.focus) prev.focus(); }
    function onKey(e) { if (e.key === "Escape" || e.key === "?") { e.stopPropagation(); e.preventDefault(); close(); } else if (e.key !== "Tab") e.stopPropagation(); }
    document.addEventListener("keydown", onKey, true);
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-x]")) close();
      else if (e.target.closest("[data-tour]")) { close(); if (o.onTour) o.onTour(); }
    });
    el.querySelector("[data-x]").focus();
    return { close, el };
  }

  function tour(o) {
    css();
    const host = o.host || document.body, steps = o.steps.filter((s) => { const t = document.querySelector(s.target); return t && t.getClientRects().length; });
    if (!steps.length) return null;
    let i = Math.min(o.startAt || 0, steps.length - 1);
    const el = document.createElement("div"); el.className = "tr-root" + (host === document.body ? " hp-fixed" : ""); el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Tour");
    el.innerHTML = `<div class="tr-hole"></div><div class="tr-card"><h4></h4><p></p><div class="tr-foot"><small></small><button class="tr-skip" data-skip>Skip</button><button class="btn" data-back>Back</button><button class="btn pri" data-next>Next</button></div></div>`;
    host.appendChild(el);
    const hole = el.querySelector(".tr-hole"), card = el.querySelector(".tr-card"), prev = document.activeElement;
    function place() {
      const s = steps[i], t = document.querySelector(s.target), r = t.getBoundingClientRect(), hr = host.getBoundingClientRect(), pad = 8;
      const x = r.left - hr.left - pad, y = r.top - hr.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
      hole.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      el.querySelector("h4").textContent = s.title; el.querySelector("p").textContent = s.body;
      el.querySelector("small").textContent = (i + 1) + " of " + steps.length;
      el.querySelector("[data-back]").style.visibility = i ? "visible" : "hidden";
      el.querySelector("[data-next]").textContent = i === steps.length - 1 ? "Done" : "Next";
      const cw = card.offsetWidth, ch = card.offsetHeight, W = hr.width, H = hr.height;
      const below = s.where ? s.where === "below" : y + h + ch + 16 < H, top = below ? y + h + 14 : y - ch - 14;
      card.style.left = Math.max(12, Math.min(W - cw - 12, x + w / 2 - cw / 2)) + "px";
      card.style.top = Math.max(12, Math.min(H - ch - 12, top)) + "px";
    }
    function finish(done) { document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", place); el.remove(); try { root.localStorage.setItem(TOURED, "1"); } catch (e) { /* ignore */ } if (prev && prev.focus) prev.focus(); if (o.onDone) o.onDone(done, i); }
    function go(n) { if (n >= steps.length) { finish(true); return; } i = Math.max(0, n); place(); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); finish(false); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.stopPropagation(); e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") { e.stopPropagation(); e.preventDefault(); go(i - 1); }
      else if (e.key !== "Tab") e.stopPropagation();              // the tour owns the keyboard: no stray shortcuts behind it
    }
    document.addEventListener("keydown", onKey, true); window.addEventListener("resize", place);
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-skip]")) finish(false);
      else if (e.target.closest("[data-back]")) go(i - 1);
      else if (e.target.closest("[data-next]")) go(i + 1);
    });
    place(); el.querySelector("[data-next]").focus();
    return { finish, go, el };
  }

  const seen = () => { try { return root.localStorage.getItem(TOURED) === "1"; } catch (e) { return false; } };
  const api = { SHORTCUTS, flat, openShortcuts, tour, seen, TOURED };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Help = api;
})(typeof self !== "undefined" ? self : this);
