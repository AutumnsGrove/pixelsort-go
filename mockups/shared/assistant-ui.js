/*
 * Shape assistant UI (mockup). Mounts the "Cut out this object" tool and the assistant panel into any host element.
 * Used by Studio (Pro panel), Phone (Assist tab). Depends on shared/assistant.js and the page's PixelDemo `d`.
 *   Assistant.mount({ host, frame, d, use(name, svg), toast(msg), phone })
 */
(function (root) {
  "use strict";
  var A = root.Assistant;
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var SUGGEST = ["Cut out the main subject", "Make a shape of the brightest object", "Shape of the dark ridge", "What are the distinct objects here?"];
  var SIMS = [["ok", "works"], ["offline", "OpenRouter down"], ["novision", "no vision"], ["nokey", "no key on server"], ["badshape", "bad outline"], ["slow", "slow"]];

  function mount(o) {
    var d = o.d, W = d.w, H = d.h, cfg = A.load(), host = typeof o.host === "string" ? document.querySelector(o.host) : o.host;
    var frame = typeof o.frame === "string" ? document.querySelector(o.frame) : o.frame;
    var st = { picking: false, tol: 32, cut: null, run: 0, cancel: false, running: false, proposal: null, log: [], objs: null, hl: null, raf: 0 };

    /* overlay: marching-ants outline + tint over the picture, and the click target while "picking" */
    var ov = el("canvas", "as-ov"); ov.width = W; ov.height = H; frame.appendChild(ov);
    var octx = ov.getContext("2d");
    function draw(t) {
      octx.clearRect(0, 0, W, H);
      var m = st.hl; if (!m) { st.raf = 0; return; }
      var id = octx.createImageData(W, H), dd = id.data, ph = Math.floor((t || 0) / 90) % 8;
      for (var i = 0; i < W * H; i++) {
        if (!m[i]) continue; var x = i % W, y = (i / W) | 0, edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W], p = i * 4;
        if (edge) { var on = ((x + y + ph) % 8) < 4; dd[p] = dd[p + 1] = dd[p + 2] = on ? 255 : 10; dd[p + 3] = 255; } else { dd[p] = 255; dd[p + 1] = 255; dd[p + 2] = 255; dd[p + 3] = 40; }
      }
      octx.putImageData(id, 0, 0);
      if (document.documentElement.dataset.motion === "reduce") { st.raf = 0; return; }
      st.raf = requestAnimationFrame(draw);
    }
    function show(mask) { st.hl = mask; if (!st.raf) st.raf = requestAnimationFrame(draw); if (!mask) octx.clearRect(0, 0, W, H); }

    /* ---------- markup ---------- */
    host.innerHTML = "";
    var root_ = el("div", "as" + (o.phone ? " as-phone" : ""));
    root_.innerHTML =
      '<div class="as-card as-cutc">' +
        '<div class="as-h"><b>Cut out this object</b><span class="as-tag">always on · no model</span></div>' +
        '<p class="as-p">Click something in the picture. The app grows a region from that point, traces its outline and offers it as a shape. Runs on your device.</p>' +
        '<div class="as-bar"><button class="btn sm" data-r="pick">Click the picture</button><button class="btn sm" data-r="bright">Brightest object</button><button class="btn sm" data-r="clear" disabled>Clear</button></div>' +
        '<div class="as-prow"><label>Tolerance <em data-r="tolV">32</em></label><input type="range" data-r="tol" min="5" max="80" value="32" aria-label="Tolerance"></div>' +
        '<div class="as-res" data-r="res" hidden></div>' +
      "</div>" +
      '<div class="as-card as-ai">' +
        '<div class="as-h"><b>Shape helper</b><span class="as-chip" data-r="chip"></span></div>' +
        '<div data-r="off" class="as-off" hidden><p class="as-p">The Shape helper is <b>off</b>. It is optional. When you use it, a small copy of your picture and your prompt go to OpenRouter, a cloud service. Cut out this object never sends anything.</p><div class="as-bar"><button class="btn sm pri" data-r="enable">Turn it on</button><a class="btn sm" href="settings.html#assistant">Settings</a></div></div>' +
        '<div data-r="on" hidden>' +
          '<div class="as-sent"><canvas data-r="thumb" width="96" height="60"></canvas><div>Sent to OpenRouter with your prompt: a <b>512 px</b> copy, no EXIF.<br><span>The original never leaves this device.</span></div></div>' +
          '<div class="as-sug" data-r="sug"></div>' +
          '<div class="as-tr" data-r="tr" aria-live="polite"></div>' +
          '<div class="as-prop" data-r="prop" hidden></div>' +
          '<div class="as-in"><textarea rows="2" data-r="inp" placeholder="Describe a shape to make…" aria-label="Ask the assistant"></textarea><button class="btn pri" data-r="send">Send</button></div>' +
          '<div class="as-foot"><span data-r="cap"></span><button class="lnk" data-r="reset" title="Mockup only">reset session</button></div>' +
        "</div>" +
      "</div>" +
      '<details class="as-dev"><summary>Developer view · tool calls</summary><pre data-r="dev">No calls yet.</pre><p class="as-p">The model only ever sees these tools: describe_image, list_objects, segment_from_point, refine_region, simplify_outline, highlight, propose_shape. It refers to regions by id; the outline always comes from the engine.</p></details>' +
      '<div class="as-sim"><span>Mockup · simulate</span>' + SIMS.map(function (s) { return '<button data-sim="' + s[0] + '">' + s[1] + "</button>"; }).join("") + "</div>" +
      '<p class="as-note">The picture work is real; the “model” is a script. Replies are canned.</p>';
    host.appendChild(root_);
    function q(r) { return root_.querySelector('[data-r="' + r + '"]'); }

    /* ---------- cut-out (slice 1) ---------- */
    function setPick(on) {
      st.picking = on; ov.classList.toggle("pick", on); q("pick").classList.toggle("on", on); q("pick").textContent = on ? "Click the picture…" : "Click the picture";
      if (on && o.beforePick) o.beforePick();
    }
    function resCard(r, name) {
      var box = q("res"); box.hidden = false;
      if (!r.ok) { box.innerHTML = '<div class="as-bad"><b>No shape from that spot</b><p>' + esc(r.message) + "</p></div>"; q("clear").disabled = false; return; }
      var nm = name || (r.name.charAt(0).toUpperCase() + r.name.slice(1) + " shape");
      box.innerHTML = '<div class="as-pv"><svg viewBox="0 0 ' + r.svg.w + " " + r.svg.h + '" preserveAspectRatio="xMidYMid meet"><path d="' + r.svg.d + '"/></svg><div><input class="as-nm" value="' + esc(nm) + '" aria-label="Shape name" maxlength="60"><p>' + r.pointsAfter + " points (from " + r.pointsBefore + ") · " + r.areaPct.toFixed(1) + '% of the picture · <span class="ok">valid</span></p></div></div>' +
        '<div class="as-bar"><button class="btn sm pri" data-r="useCut">Use it</button><button class="btn sm" data-r="tidyCut">Edit in tidy</button></div><p class="as-p">Nothing is added to your shapes until you press Use it.</p>';
      var nameIn = box.querySelector(".as-nm");
      box.querySelector('[data-r="useCut"]').onclick = function () { var n = nameIn.value || nm, m = o.use(n, r.svg.svg); o.toast && o.toast(m || "Added “" + n + "” to your shapes"); };
      box.querySelector('[data-r="tidyCut"]').onclick = function () { o.use(nameIn.value || nm, r.svg.svg); };
      q("clear").disabled = false;
    }
    function cutAt(x, y) {
      var r = A.cutout(d.orig, W, H, x, y, st.tol); st.cut = { x: x, y: y, r: r };
      show(r.ok ? r.mask : null); resCard(r);
      log("segment_from_point", { x: +(x / W).toFixed(3), y: +(y / H).toFixed(3), tolerance: st.tol }, r.ok ? { area_pct: +r.areaPct.toFixed(1), points: r.pointsAfter } : { error: r.reason });
    }
    ov.addEventListener("pointerdown", function (e) {
      if (!st.picking) return; e.preventDefault(); e.stopPropagation();
      var b = ov.getBoundingClientRect(); cutAt((e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H); setPick(false);
    });
    q("pick").onclick = function () { setPick(!st.picking); };
    q("bright").onclick = function () { var s = A.describe(d.orig, W, H).brightest; setPick(false); cutAt(s[0] * W, s[1] * H); };
    q("clear").onclick = function () { st.cut = null; show(null); q("res").hidden = true; q("clear").disabled = true; setPick(false); };
    q("tol").addEventListener("input", function (e) { st.tol = +e.target.value; q("tolV").textContent = st.tol; if (st.cut) { clearTimeout(st._t); st._t = setTimeout(function () { cutAt(st.cut.x, st.cut.y); }, 90); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && st.picking) setPick(false); });

    /* ---------- dev log ---------- */
    function log(name, args, res) {
      st.log.push("→ " + name + " " + JSON.stringify(args) + "\n← " + JSON.stringify(res));
      q("dev").textContent = st.log.slice(-8).join("\n\n");
    }

    /* ---------- assistant ---------- */
    var cap = function () { return cfg.cap === 0 ? Infinity : cfg.cap; };
    function paint() {
      cfg = A.load();
      var down = cfg.sim === "offline" || cfg.sim === "nokey";
      q("chip").textContent = cfg.on ? (cfg.sim === "offline" ? "OpenRouter down" : cfg.sim === "nokey" ? "not set up" : "cloud · OpenRouter") : "off"; q("chip").className = "as-chip " + (cfg.on && down ? "bad" : "");
      q("off").hidden = cfg.on; q("on").hidden = !cfg.on;
      q("cap").textContent = (cfg.cap === 0 ? cfg.used + " requests this session · no cap" : cfg.used + " of " + cfg.cap + " requests used this session");
      root_.querySelectorAll("[data-sim]").forEach(function (b) { b.classList.toggle("on", b.dataset.sim === cfg.sim); });
      var t = q("thumb").getContext("2d"), tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
      tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(new Uint32Array(d.orig).buffer), W, H), 0, 0); t.drawImage(tmp, 0, 0, 96, 60);
    }
    q("enable").onclick = function () { A.save({ on: true }); paint(); };
    q("reset").onclick = function () { A.save({ used: 0 }); paint(); };
    root_.querySelectorAll("[data-sim]").forEach(function (b) { b.onclick = function () { A.save({ sim: b.dataset.sim }); paint(); }; });
    q("sug").innerHTML = SUGGEST.map(function (s) { return '<button class="chip" type="button">' + esc(s) + "</button>"; }).join("");
    q("sug").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { q("inp").value = b.textContent; send(); } });
    q("inp").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } e.stopPropagation(); });
    q("send").onclick = function () { if (st.running) { st.cancel = true; } else send(); };

    function row(kind, html) { var r = el("div", "as-step " + kind, html); q("tr").appendChild(r); q("tr").scrollTop = 1e6; return r; }
    function say(text, extra) { return q("tr").appendChild(el("div", "as-say", esc(text) + (extra || ""))); }
    function setRunning(on) { st.running = on; q("send").textContent = on ? "Cancel" : "Send"; q("send").classList.toggle("pri", !on); q("inp").disabled = on; }
    function fail(title, body, actions) {
      var f = el("div", "as-bad", "<b>" + title + "</b><p>" + body + "</p>" + (actions || "")); q("tr").appendChild(f); return f;
    }
    function consent() {
      return new Promise(function (res) {
        var f = el("div", "as-bad", "<b>First time on this device</b><p>The Shape helper sends a 512 px copy of your picture (no EXIF) and your prompt to OpenRouter, a cloud service, to find shapes. The original never leaves. You’ll only see this once on this device; you can bring it back in Settings.</p><div class=\"as-bar\"><button class=\"btn sm pri\" data-y>Got it, send</button><button class=\"btn sm\" data-n>Not now</button></div>");
        q("tr").appendChild(f); f.querySelector("[data-y]").onclick = function () { f.remove(); res(true); }; f.querySelector("[data-n]").onclick = function () { f.remove(); res(false); };
      });
    }
    async function step(name, args, ms, fn) {
      var r = row("run", '<span class="ic">●</span><span><b>' + name + "</b><br><small>" + esc(JSON.stringify(args)) + '</small></span><small data-t>…</small>');
      var t0 = performance.now(); await sleep(cfg.sim === "slow" ? ms * 5 : ms); if (st.cancel) { r.className = "as-step"; r.querySelector(".ic").textContent = "–"; r.querySelector("[data-t]").textContent = "stopped"; throw "cancel"; }
      var out; try { out = fn(); } catch (e) { r.className = "as-step err"; r.querySelector(".ic").textContent = "✕"; throw e; }
      r.className = "as-step"; r.querySelector(".ic").textContent = "✓"; r.querySelector("[data-t]").textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s";
      if (out && out.note) r.querySelector("small").textContent = out.note; log(name, args, out && out.res); return out;
    }

    async function send() {
      var prompt = q("inp").value.trim(); if (!prompt || st.running) return;
      cfg = A.load();
      q("prop").hidden = true; st.proposal = null;
      q("tr").appendChild(el("div", "as-me", esc(prompt))); q("inp").value = "";
      if (cfg.used >= cap()) { fail("You’ve used " + cfg.used + " of " + cfg.cap + " requests this session", "Raise the limit in Settings, or use Cut out this object (no limit).", '<div class="as-bar"><a class="btn sm" href="settings.html#assistant">Settings</a></div>'); return; }
      if (cfg.sim === "offline") { fail("Can’t reach OpenRouter", "Nothing came back from OpenRouter. Your picture was not sent.", '<div class="as-bar"><button class="btn sm pri" data-retry>Retry</button><a class="btn sm" href="settings.html#assistant">Open settings</a></div><p class="as-p">You can still use <b>Cut out this object</b>.</p>').querySelector("[data-retry]").onclick = function () { A.save({ sim: "ok" }); paint(); }; return; }
      if (cfg.sim === "nokey") { fail("The Shape helper isn’t set up on this server", "No OpenRouter key is configured. Set PIXELSORT_OPENROUTER_KEY on the server and restart it. Nothing was sent.", '<div class="as-bar"><a class="btn sm" href="settings.html#assistant">Settings</a></div><p class="as-p">Cut out this object still works.</p>'); return; }
      if (cfg.sim === "novision") { fail("This model can’t see pictures", esc(cfg.model) + " doesn’t accept pictures. The Shape helper needs a model with vision: pick another in Settings, or use Cut out this object."); return; }
      st.cancel = false; setRunning(true);
      try {
        if (!cfg.noticed) { if (!(await consent())) { say("Cancelled. Nothing was sent."); setRunning(false); return; } A.save({ noticed: true }); }
        A.save({ used: cfg.used + 1 }); paint();
        var pl = A.plan(prompt);
        var think = el("div", "as-think", "The model is working…"); q("tr").appendChild(think);
        await sleep(cfg.sim === "slow" ? 2500 : 500); think.remove(); if (st.cancel) throw "cancel";
        if (pl.kind === "none") { say("I can make a shape from something in the picture, like “the sun” or “the dark ridge”, or you can click an object yourself with Cut out this object.", '<div class="as-note2">No shape proposed.</div>'); setRunning(false); return; }
        await step("describe_image", {}, 350, function () { var r = A.describe(d.orig, W, H); return { res: r, note: "palette " + r.palette.length + " · edges " + r.edge_density }; });
        var objs = (await step("list_objects", { min_area_pct: 1, max: 8 }, 600, function () { var l = A.listObjects(d.orig, W, H, 1, 8); st.objs = l; return { res: l.map(function (x) { return { id: x.id, name: x.name, area_pct: x.area_pct }; }), note: l.length + " candidates", objs: l }; })).objs;
        if (pl.kind === "list") {
          say("I can see " + objs.length + " distinct areas: " + objs.slice(0, 5).map(function (x) { return x.name + " (" + x.area_pct + "%)"; }).join("; ") + ". Which should I cut out?");
          var ch = el("div", "as-sug"); objs.slice(0, 5).forEach(function (x) { var b = el("button", "chip", esc(x.name)); b.onclick = function () { q("inp").value = "Cut out the " + x.name; send(); }; ch.appendChild(b); }); q("tr").appendChild(ch);
          setRunning(false); return;
        }
        var pick = A.pickObject(objs, pl.pick, W, H);
        if (!pick) { say("I couldn’t find a clear object to cut out."); setRunning(false); return; }
        say("The " + pick.name + " area looks clearest.");
        await step("highlight", { region: pick.id }, 250, function () { show(pick._r.mask); return { res: { ok: true } }; });
        var cut = (await step("segment_from_point", { x: +(pick.seed[0] / W).toFixed(3), y: +(pick.seed[1] / H).toFixed(3), tolerance: 28 }, 800, function () {
          var r = A.cutout(d.orig, W, H, pick.seed[0], pick.seed[1], 28); if (!r.ok) throw new Error(r.message); return { res: { region: pick.id, area_pct: +r.areaPct.toFixed(1), points: r.pointsBefore }, cut: r };
        })).cut;
        await step("simplify_outline", { region: pick.id, tolerance: 1.4 }, 300, function () { return { res: { points_before: cut.pointsBefore, points_after: cut.pointsAfter }, note: cut.pointsBefore + " → " + cut.pointsAfter + " points" }; });
        var nm = pl.name || (pick.name.charAt(0).toUpperCase() + pick.name.slice(1));
        var bad = cfg.sim === "badshape";
        await step("propose_shape", { region: pick.id, name: nm }, 250, function () { if (bad) throw new Error("outline rejected"); return { res: { valid: true, points: cut.pointsAfter, holes: 0 } }; }).catch(function (e) {
          if (e === "cancel") throw e;
          row("err", '<span class="ic">✕</span><span><b>propose_shape</b><br><small>outline rejected: 9,412 points (limit 2,000)</small></span><small>0.1 s</small>');
          fail("That shape was too complicated to use", "Nothing was added. Your library is unchanged.", '<div class="as-bar"><button class="btn sm pri" data-simple>Try again with a simpler outline</button></div>').querySelector("[data-simple]").onclick = function () { A.save({ sim: "ok" }); paint(); q("inp").value = prompt; send(); };
          throw "handled";
        });
        showProposal(nm, cut); say("That’s a shape you can use. Nothing is added until you press Use it."); setRunning(false);
      } catch (e) {
        if (e === "cancel") { say("Cancelled. Nothing was changed.", ""); show(st.cut && st.cut.r.ok ? st.cut.r.mask : null); } else if (e !== "handled") { fail("The assistant hit a problem", esc(e && e.message || e)); }
        setRunning(false);
      }
    }

    function showProposal(nm, cut) {
      var p = q("prop"); st.proposal = { nm: nm, cut: cut }; p.hidden = false;
      p.innerHTML = '<div class="eyebrow2">Proposed shape</div><div class="as-pv"><svg viewBox="0 0 ' + cut.svg.w + " " + cut.svg.h + '" preserveAspectRatio="xMidYMid meet"><path d="' + cut.svg.d + '"/></svg><div><input class="as-nm" value="' + esc(nm) + '" aria-label="Shape name" maxlength="60"><p>' + cut.pointsAfter + " points · 0 holes · " + cut.areaPct.toFixed(1) + '% of picture · <span class="ok">validator passed</span></p></div></div><div class="as-bar"><button class="btn sm pri" data-u>Use it</button><button class="btn sm" data-e>Edit</button><button class="btn sm" data-t>Try again</button></div><p class="as-p">Nothing is added until you press Use it.</p>';
      var nameIn = p.querySelector(".as-nm");
      p.querySelector("[data-u]").onclick = function () { var n = nameIn.value || nm, m = o.use(n, cut.svg.svg) || "Added “" + n + "” to your shapes. It’s now the active tile."; o.toast && o.toast(m); p.hidden = true; show(null); say(m); };
      p.querySelector("[data-e]").onclick = function () { o.use(nameIn.value || nm, cut.svg.svg); };
      p.querySelector("[data-t]").onclick = function () { p.hidden = true; show(null); var last = q("tr").querySelectorAll(".as-me"); q("inp").value = last.length ? last[last.length - 1].textContent : ""; };
    }

    paint();
    window.addEventListener("storage", paint);
    return { paint: paint, pick: function () { setPick(true); }, cutAt: cutAt };
  }
  root.Assistant.mount = mount;
})(window);
