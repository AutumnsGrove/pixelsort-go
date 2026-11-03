/*
 * Export dialog — one component for Studio and the phone sheet. Needs theater.css and export-model.js.
 * The export itself is simulated (a timer walks the bands); nothing is written anywhere.
 *
 *   ExportDialog.open({ host, name, w, h, recipe, device, toast })
 *
 * States: setup -> running (banded progress, cancel) -> done. Cancelling returns to setup.
 * "mock controls" at the bottom let a reviewer pretend the photo or the device is different; the real app has none.
 */
(function (root) {
  "use strict";
  const M = root.ExportModel;
  let styled = false;

  function css() {
    if (styled) return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.xd{position:absolute;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:rgba(8,7,6,.78);backdrop-filter:blur(10px);animation:xdin .25s var(--ease) both}
.xd.xd-sheet{place-items:end center;padding:0}
@keyframes xdin{from{opacity:0}to{opacity:1}}
.xd-card{width:min(540px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;animation:xdup .4s var(--ease) both}
.xd.xd-sheet .xd-card{border-radius:30px 30px 0 0;width:100%;max-height:92%}
@keyframes xdup{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
.xd-head{display:flex;justify-content:space-between;align-items:flex-start;padding:22px 24px 12px}
.xd-head h3{font-size:30px;line-height:1;margin-top:6px}
.xd-body{overflow-y:auto;padding:0 24px 8px;scrollbar-width:thin}
.xd-foot{display:flex;gap:10px;justify-content:flex-end;padding:14px 24px 22px;border-top:1px solid var(--faint2)}
.xd-foot .btn{min-height:44px}
.xd-lbl{font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim);margin:16px 0 8px;display:flex;justify-content:space-between}
.xd-lbl em{font-style:normal;color:var(--paper);letter-spacing:.5px;text-transform:none}
.xd-hint{font-size:10.5px;color:var(--dim);line-height:1.6;margin-top:8px}
.xd .chips button{min-height:40px}
.xd-sizes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.xd-sizes button{display:grid;gap:3px;text-align:left;padding:10px 14px;border:1px solid var(--faint);border-radius:14px;transition:.15s}
.xd-sizes button:hover{border-color:var(--dim)}
.xd-sizes button.on{border-color:var(--ver);background:rgba(255,90,54,.08)}
.xd-sizes button.off{opacity:.38}
.xd-sizes b{font-family:var(--serif);font-weight:400;font-size:21px;line-height:1}
.xd-sizes small{font-size:10px;color:var(--dim);letter-spacing:.3px}
.xd-mem{border:1px solid var(--faint);border-radius:16px;padding:12px 14px;margin-top:16px}
.xd-mem .row{display:flex;justify-content:space-between;font-size:11px;color:var(--dim)}
.xd-mem .row b{color:var(--paper);font-weight:500}
.xd-bar{height:4px;border-radius:4px;background:var(--faint);margin:9px 0;overflow:hidden}
.xd-bar i{display:block;height:100%;width:0;background:var(--ok);transition:width .35s var(--ease),background .2s}
.xd-mem.banded .xd-bar i{background:var(--gold)}
.xd-mem.toolarge .xd-bar i{background:var(--ver)}
.xd-verdict{font-size:11px;line-height:1.65;color:var(--paper)}
.xd-mem.toolarge .xd-verdict{color:var(--ver)}
.xd-verdict button{color:var(--gold);border-bottom:1px solid var(--gold);font-size:inherit}
.xd-mock{margin:18px 0 6px;padding:12px 14px;border:1px dashed rgba(236,228,211,.22);border-radius:14px}
.xd-mock .xd-lbl{margin:0 0 6px}
.xd-mock .chips{margin-bottom:8px}.xd-mock .chips:last-child{margin-bottom:0}
.xd-mock .chips button{min-height:32px;padding:0 12px;font-size:10.5px}
.xd-run{display:none;padding:18px 0 14px;text-align:center}
.xd-run h4{font-family:var(--serif);font-style:italic;font-weight:400;font-size:34px;margin:6px 0 4px}
.xd-run p{color:var(--dim);font-size:11px;line-height:1.7}
.xd-prog{height:3px;background:var(--faint);margin:20px 0 10px;position:relative}
.xd-prog i{position:absolute;left:0;top:0;height:100%;width:0;background:var(--ver);box-shadow:0 0 10px var(--ver)}
.xd-bands{display:flex;gap:3px;margin:12px 0}
.xd-bands i{flex:1;height:14px;border-radius:3px;background:var(--faint2);border:1px solid var(--faint2)}
.xd-bands i.cur{border-color:var(--ver);background:rgba(255,90,54,.25)}
.xd-bands i.done{background:var(--paper);border-color:var(--paper);opacity:.85}
.xd-check{width:64px;height:64px;border-radius:50%;margin:0 auto 6px;display:grid;place-items:center;background:var(--ver);color:var(--ink)}
.xd-check svg{width:30px;height:30px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.xd[data-view=running] .xd-setup,.xd[data-view=done] .xd-setup{display:none}
.xd[data-view=running] .xd-run.r,.xd[data-view=done] .xd-run.d{display:block}
.xd[data-view=running] .f-setup,.xd[data-view=done] .f-setup,.xd .f-run,.xd .f-done{display:none}
.xd[data-view=running] .f-run,.xd[data-view=done] .f-done{display:flex;gap:10px}
.xd-foot .btn.pri[disabled]{box-shadow:none}
`;
    document.head.appendChild(s);
  }

  const $ = (el, q) => el.querySelector(q);
  const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function open(o) {
    css();
    const host = o.host || document.body, M0 = M;
    const st = { format: "png", quality: 92, scale: 1, recipeMeta: true, strip: true, device: o.device || "desktop", srcW: o.w, srcH: o.h, timer: 0 };
    const root_ = document.createElement("div");
    root_.className = "xd" + (o.sheet ? " xd-sheet" : "");
    root_.dataset.view = "setup";
    root_.setAttribute("role", "dialog"); root_.setAttribute("aria-modal", "true"); root_.setAttribute("aria-labelledby", "xdT");
    root_.innerHTML = `
<div class="xd-card glass">
  <div class="xd-head"><div><div class="eyebrow">Export</div><h3 id="xdT" class="serif-i">Take it with you</h3></div><button class="round xd-x" title="Close (Esc)">${X}</button></div>
  <div class="xd-body">
    <div class="xd-setup">
      <div class="xd-lbl">Format</div>
      <div class="chips" data-fmt>${Object.keys(M0.FORMATS).map((k) => `<button data-v="${k}">${M0.FORMATS[k].name}</button>`).join("")}</div>
      <p class="xd-hint" data-fmtnote></p>
      <div data-q style="display:none"><div class="xd-lbl">Quality <em data-qv></em></div><input type="range" data-qr min="40" max="100" value="92"></div>
      <div class="xd-lbl">Size <em data-sizeem></em></div>
      <div class="xd-sizes" data-sizes></div>
      <div class="tog" data-tog="recipeMeta"><div><b>Write the recipe into the file</b><small>so you can reopen the exact look later</small></div><div class="sw on"></div></div>
      <div class="tog" data-tog="strip"><div><b>Strip location and camera data</b><small>from the original photo — on by default</small></div><div class="sw on"></div></div>
      <div class="xd-mem" data-mem>
        <div class="row"><span>Memory this export needs</span><b data-memv></b></div>
        <div class="xd-bar"><i data-membar></i></div>
        <div class="xd-verdict" data-verdict></div>
      </div>
      <div class="xd-mock">
        <div class="xd-lbl"><span>Mockup only · pretend the photo is</span></div>
        <div class="chips" data-mockphoto><button data-w="${o.w}" data-h="${o.h}">${o.w}×${o.h}</button><button data-w="6000" data-h="4000">24 MP</button><button data-w="8660" data-h="5774">50 MP</button></div>
        <div class="xd-lbl"><span>…and this device is</span></div>
        <div class="chips" data-mockdev><button data-v="desktop">Desktop</button><button data-v="phone">Phone</button></div>
      </div>
    </div>
    <div class="xd-run r"><div class="eyebrow" data-rband></div><h4 data-rh>Sorting…</h4><div class="xd-prog"><i data-rprog></i></div><div class="xd-bands" data-rbands></div><p data-rp></p></div>
    <div class="xd-run d"><div class="xd-check">${CHECK}</div><h4>Saved.</h4><p data-dp></p></div>
  </div>
  <div class="xd-foot f-setup"><button class="btn" data-act="close">Cancel</button><button class="btn pri" data-act="go"></button></div>
  <div class="xd-foot f-run"><button class="btn" data-act="cancel">Cancel export</button></div>
  <div class="xd-foot f-done"><button class="btn" data-act="again">Download again</button><button class="btn pri" data-act="close">Done</button></div>
</div>`;
    host.appendChild(root_);

    const cur = () => ({ w: Math.max(1, Math.round(st.srcW * st.scale)), h: Math.max(1, Math.round(st.srcH * st.scale)) });
    const stop = () => { clearInterval(st.timer); st.timer = 0; };
    const prevFocus = document.activeElement;
    function close() { stop(); document.removeEventListener("keydown", onKey, true); root_.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); if (root_.dataset.view === "running") cancel(); else close(); } }
    document.addEventListener("keydown", onKey, true);

    function update() {
      const f = M0.FORMATS[st.format], d = cur(), p = M0.plan(d.w, d.h, st.device), bytes = M0.estimateBytes(st.format, st.quality, d.w * d.h);
      $(root_, "[data-fmt]").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === st.format));
      $(root_, "[data-fmtnote]").textContent = f.note;
      $(root_, "[data-q]").style.display = f.lossy ? "block" : "none"; $(root_, "[data-qv]").textContent = st.quality;
      $(root_, "[data-sizeem]").textContent = d.w + " × " + d.h;
      $(root_, "[data-sizes]").innerHTML = M0.SCALES.map((s) => {
        const w = Math.round(st.srcW * s), h = Math.round(st.srcH * s), pl = M0.plan(w, h, st.device);
        return `<button data-s="${s}" class="${s === st.scale ? "on" : ""}${pl.verdict === "toolarge" ? " off" : ""}"><b>${s === 1 ? "Full size" : Math.round(s * 100) + "%"}</b><small>${w}×${h} · ${M0.fmtMP(w * h)}${pl.verdict === "toolarge" ? " · too large here" : ""}</small></button>`;
      }).join("");
      root_.querySelectorAll("[data-tog]").forEach((t) => t.querySelector(".sw").classList.toggle("on", st[t.dataset.tog]));
      const mem = $(root_, "[data-mem]"); mem.className = "xd-mem " + p.verdict;
      $(root_, "[data-memv]").textContent = Math.round(p.memMB).toLocaleString() + " MB of " + p.budgetMB.toLocaleString();
      $(root_, "[data-membar]").style.width = Math.min(100, (p.memMB / p.budgetMB) * 100) + "%";
      const v = $(root_, "[data-verdict]");
      if (p.verdict === "ok") v.textContent = "Fits comfortably — sorted in one pass.";
      else if (p.verdict === "banded") v.textContent = "A big picture: it will be sorted in " + p.bands + " bands of lines so it fits on this " + M0.DEVICES[st.device].name.toLowerCase() + ". Same result, a little slower.";
      else {
        const s = M0.suggestScale(st.srcW, st.srcH, st.device);
        v.innerHTML = "Too large for this " + M0.DEVICES[st.device].name.toLowerCase() + " — even in the thinnest bands it needs " + Math.round(p.memMB) + " MB. " + (s ? `Export at <button data-fit="${s}">${Math.round(s * 100)}%</button> instead, or open this run on a computer.` : "Open this run on a computer.");
      }
      $(root_, "[data-mockphoto]").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.w === st.srcW));
      $(root_, "[data-mockdev]").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === st.device));
      const go = $(root_, '[data-act="go"]'); go.textContent = p.verdict === "toolarge" ? "Too large" : "Export " + f.name + " · about " + M0.fmtBytes(bytes);
      go.disabled = p.verdict === "toolarge";
    }

    function run() {
      const d = cur(), p = M0.plan(d.w, d.h, st.device), ranges = M0.bandRanges(d.h, p.bands), per = Math.max(110, Math.min(420, 3200 / p.bands));
      root_.dataset.view = "running"; let i = 0;
      $(root_, "[data-rbands]").innerHTML = ranges.map(() => "<i></i>").join("");
      const paint = () => {
        const bs = $(root_, "[data-rbands]").children;
        for (let k = 0; k < bs.length; k++) bs[k].className = k < i ? "done" : k === i ? "cur" : "";
        $(root_, "[data-rband]").textContent = p.bands === 1 ? "One pass" : "Band " + Math.min(i + 1, p.bands) + " of " + p.bands;
        $(root_, "[data-rprog]").style.width = (i / p.bands) * 100 + "%";
        $(root_, "[data-rp]").textContent = i < p.bands ? "Sorting lines " + ranges[i][0].toLocaleString() + "–" + ranges[i][1].toLocaleString() + " of " + d.h.toLocaleString() + " · " + d.w + "×" + d.h + " " + M0.FORMATS[st.format].name + (p.bands > 1 ? " · about " + Math.round(M0.memoryMB(d.w * d.h, p.bands)) + " MB at a time" : "") : "Encoding…";
      };
      paint();
      st.timer = setInterval(() => {
        i++; paint();
        if (i > p.bands) { stop(); finish(d); }
      }, per);
    }
    function finish(d) {
      root_.dataset.view = "done";
      const name = M0.filename(o.name, o.recipe, st.format, "0f3a"), size = M0.fmtBytes(M0.estimateBytes(st.format, st.quality, d.w * d.h));
      st.last = name;
      $(root_, "[data-dp]").innerHTML = name + "<br>" + d.w + " × " + d.h + " · " + size + (st.strip ? " · location and camera data removed" : "") + (st.recipeMeta ? " · recipe embedded" : "");
      if (o.toast) o.toast("Exported " + name);
    }
    function cancel() { stop(); root_.dataset.view = "setup"; update(); if (o.toast) o.toast("Cancelled — nothing was saved"); }

    root_.addEventListener("click", (e) => {
      const t = e.target;
      if (t === root_ && root_.dataset.view !== "running") { close(); return; }
      if (t.closest(".xd-x")) { if (root_.dataset.view === "running") cancel(); else close(); return; }
      const act = t.closest("[data-act]");
      if (act) {
        const a = act.dataset.act;
        if (a === "close") close(); else if (a === "go") run(); else if (a === "cancel") cancel();
        else if (a === "again" && o.toast) o.toast("Downloaded " + st.last + " again");
        return;
      }
      const fit = t.closest("[data-fit]"); if (fit) { st.scale = +fit.dataset.fit; update(); return; }
      const f = t.closest("[data-fmt] button"); if (f) { st.format = f.dataset.v; update(); return; }
      const s = t.closest("[data-s]"); if (s) { const sc = +s.dataset.s, d = { w: Math.round(st.srcW * sc), h: Math.round(st.srcH * sc) }; if (M0.plan(d.w, d.h, st.device).verdict === "toolarge") { if (o.toast) o.toast("Too large for this " + M0.DEVICES[st.device].name.toLowerCase()); return; } st.scale = sc; update(); return; }
      const tg = t.closest("[data-tog]"); if (tg) { st[tg.dataset.tog] = !st[tg.dataset.tog]; update(); return; }
      const mp = t.closest("[data-mockphoto] button"); if (mp) { st.srcW = +mp.dataset.w; st.srcH = +mp.dataset.h; st.scale = 1; update(); return; }
      const md = t.closest("[data-mockdev] button"); if (md) { st.device = md.dataset.v; update(); return; }
    });
    $(root_, "[data-qr]").addEventListener("input", (e) => { st.quality = +e.target.value; update(); });
    update();
    const go = $(root_, '[data-act="go"]'); (go.disabled ? $(root_, ".xd-x") : go).focus();
    return { close, el: root_ };
  }

  root.ExportDialog = { open };
})(typeof self !== "undefined" ? self : this);
