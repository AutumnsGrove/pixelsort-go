/*
 * Updater — the "Updates" block in Settings. Same pattern as Warbler, Polaris and Ivy (docs/update.md):
 * the app never touches Docker and never names an image. It drops a signal file ("check" or "requested") and a
 * small watcher on the server does the pull, the health check and the rollback, then writes "result".
 *
 *   Updater.deriveView(input)      pure: what the block should say. Port this one; it is the state machine.
 *   Updater.createSim(opts)        a stand-in for the watcher + the five /api/update endpoints, driven by a clock
 *   Updater.mount({ host, ... })   renders the block, polls while something is happening, never while idle
 *
 * Mockup switches (Settings page): ?update=ready (default: up to date, "Check" finds one) · available · uptodate ·
 * fail (rolls back fine) · rollbackfail · silent (the watcher never answers) · none (not installed) · stale
 * (watcher went quiet) · &updatefast (10x quicker).
 */
(function (root) {
  "use strict";
  const STALE_HEARTBEAT_MS = 30 * 60 * 1000;   // the watcher's timer ticks every 10 min; three missed = gone quiet
  const NO_ANSWER_MS = 90 * 1000;              // request file gone, still no result
  const SLOW_MS = 5 * 60 * 1000;
  const VERSION_RE = /^r\d+\.[0-9a-f]{7,}$/;   // r<commit count>.<short sha>, stamped in at build time
  const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
  const REQUEST_BODY = "latest";               // the only thing the app may ever write into "requested"

  const short = (d) => String(d || "").replace(/^sha256:/, "").slice(0, 12);

  /** Why the Update button must wait, or null. Exports run in the browser, so only the page can know. */
  function blockReason(busy) {
    busy = busy || {};
    if (busy.exporting) return "Finish your export first.";
    if (busy.saving) return "A run is still saving. It only takes a moment.";
    return null;
  }

  /** The app refuses to write anything but the word "latest" — never an image name, tag or digest. */
  const validRequest = (body) => body === REQUEST_BODY;

  /** A tab opened before an update still runs the old page and old engine. True when the server has moved on. */
  const staleTab = (loaded, serving) => VERSION_RE.test(loaded || "") && VERSION_RE.test(serving || "") && loaded !== serving;

  /**
   * input: { info, available, checkPending, updatePending, result, startedAt, startedFromVersion, runningVersion,
   *          serverUnreachable, pendingClearedAt, busy, now }
   * returns { kind, blocked?, ... } where kind is one of
   *   loading · no_updater · checking · up_to_date · available · updating · done · failed
   */
  function deriveView(i) {
    i = i || {}; const now = i.now == null ? Date.now() : i.now;
    const blocked = blockReason(i.busy);
    if (i.startedAt != null) {
      const r = i.result;
      const answered = r && !i.updatePending && Date.parse(r.finished_at) >= i.startedAt - 1000;
      if (answered) {
        if (r.status === "ok" && i.runningVersion && i.runningVersion !== i.startedFromVersion) return { kind: "done", version: i.runningVersion };
        if (r.status === "skipped") return { kind: "up_to_date", checkedAt: r.finished_at, note: r.detail || "" };
        if (r.status === "failed" || r.status === "ok") return { kind: "failed", detail: r.detail || "", rollbackFailed: r.rollback === "failed", blocked };
      }
      if (!i.updatePending && !answered && i.pendingClearedAt != null && now - i.pendingClearedAt > NO_ANSWER_MS) {
        return { kind: "failed", rollbackFailed: false, blocked, detail: "The updater did not report back within 90 seconds. Nothing is known to be wrong, but check the server." };
      }
      return { kind: "updating", slow: now - i.startedAt > SLOW_MS, reconnecting: !!i.serverUnreachable };
    }
    if (!i.info) return { kind: "loading" };
    if (i.info.updater !== "ready" || (i.info.heartbeatAgeMs != null && i.info.heartbeatAgeMs > STALE_HEARTBEAT_MS)) {
      return { kind: "no_updater", stale: i.info.updater === "ready" };
    }
    if (i.checkPending) return { kind: "checking" };
    if (i.available && i.available.update_available) return { kind: "available", latest: i.available.latest, blocked };
    return { kind: "up_to_date", checkedAt: i.available ? i.available.checked_at : null };
  }

  /* ------------------------------------------------------------------------------------------------------------
   * The simulator. Timeline of one update, from the moment "requested" appears (T = timing):
   *   0 .. pull          the watcher resolves, snapshots, pulls — the app still answers
   *   pull .. pull+down  the container is being replaced — every request fails
   *   pull+down          healthy: version changes, result "ok"      | fail: old version back, result "failed"
   *                      rollbackfail: nothing healthy, result "failed" + rollback "failed" | silent: no result at all
   * ---------------------------------------------------------------------------------------------------------- */
  function createSim(o) {
    o = o || {};
    const scenario = o.scenario || "ready", now = o.now || Date.now;
    const T = Object.assign({ check: 1400, pull: 2600, down: 1100 }, o.timing);
    const S = { version: o.version || "r13.327bb45", latest: o.latest || "r14.9a1c4e2", latestDigest: "sha256:" + "9a1c4e2b7f".repeat(7).slice(0, 64) };
    let checkAt = null, reqAt = null, result = null, checkedAt = null, applied = false, pending = false;
    let available = scenario === "available" ? { current: short("sha256:" + "327bb45a1d".repeat(7)), latest: short(S.latestDigest), latest_digest: S.latestDigest, checked_at: new Date(now()).toISOString(), update_available: true } : null;
    const iso = (t) => new Date(t).toISOString();
    const wontHave = scenario === "uptodate";

    function advance() {
      const t = now();
      if (checkAt != null && t - checkAt >= T.check) {
        checkAt = null; checkedAt = iso(t);
        const has = !wontHave && !applied;
        available = { current: short("sha256:" + "327bb45a1d".repeat(7)), latest: has ? short(S.latestDigest) : short("sha256:" + "327bb45a1d".repeat(7)), latest_digest: has ? S.latestDigest : "", checked_at: checkedAt, update_available: has };
      }
      if (reqAt != null && t - reqAt >= T.pull + T.down) {
        const fin = reqAt + T.pull + T.down; reqAt = null; pending = false;
        if (scenario === "fail") result = { status: "failed", detail: "The new version did not become healthy in 120 seconds. Restored the backup and started the previous version.", rollback: "ok", target: S.latest, finished_at: iso(fin) };
        else if (scenario === "rollbackfail") result = { status: "failed", detail: "The new version did not start, and the previous version did not start either.", rollback: "failed", target: S.latest, finished_at: iso(fin) };
        else if (scenario === "silent") result = null;
        else { applied = true; S.version = S.latest; available = null; result = { status: "ok", detail: "", target: S.latest, finished_at: iso(fin) }; }
      }
    }
    const down = () => reqAt != null && now() - reqAt >= T.pull && now() - reqAt < T.pull + T.down;
    const gone = () => new Error("Failed to fetch");

    return {
      scenario, S,
      async getVersion() {
        advance(); if (down()) throw gone();
        const stale = scenario === "stale";
        return { version: S.version, deployment: "docker", updater: scenario === "none" ? "not installed" : "ready", heartbeatAgeMs: stale ? 3 * 60 * 60 * 1000 : 4 * 60 * 1000 };
      },
      async getAvailable() { advance(); if (down()) throw gone(); return { available, check_pending: checkAt != null }; },
      async getStatus() { advance(); if (down()) throw gone(); return { pending: reqAt != null || pending, result }; },
      async check() { advance(); if (down()) throw gone(); checkAt = now(); return { ok: true }; },
      async start(body) {
        if (!validRequest(body)) throw new Error("The app only ever asks for the latest version.");
        advance(); if (down()) throw gone(); result = null; reqAt = now(); pending = true; return { ok: true };
      },
    };
  }

  /* ------------------------------------------------------------------------------------------------------------
   * UI
   * ---------------------------------------------------------------------------------------------------------- */
  let styled = false;
  function css() {
    if (styled || typeof document === "undefined") return; styled = true;
    const s = document.createElement("style");
    s.textContent = `
.up-facts{display:grid;grid-template-columns:120px 1fr;gap:6px 18px;margin:8px 0 18px;font-size:12px}
.up-facts dt{color:var(--dim);font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;align-self:center}
.up-facts dd{margin:0;color:var(--paper)}
.up-card{border:1px solid var(--faint);border-radius:18px;padding:18px 20px;display:grid;gap:12px}
.up-card.warn{border-color:rgba(255,90,54,.4)}
.up-head{display:flex;align-items:center;gap:12px}
.up-dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--dim)}
.up-card[data-kind=up_to_date] .up-dot{background:#7fb88a}
.up-card[data-kind=available] .up-dot{background:var(--gold)}
.up-card[data-kind=checking] .up-dot,.up-card[data-kind=updating] .up-dot{background:var(--gold);animation:uppulse 1.1s ease-in-out infinite}
.up-card[data-kind=failed] .up-dot{background:var(--ver)}
@keyframes uppulse{50%{opacity:.25}}
.up-title{font-family:var(--serif);font-style:italic;font-size:24px;line-height:1.1}
.up-text{color:var(--dim);font-size:11.5px;line-height:1.75;max-width:520px;margin:0}
.up-text b{color:var(--paper);font-weight:500}
.up-small{color:var(--dim);font-size:10.5px;line-height:1.7;margin:0;max-width:520px}
.up-act{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.up-act .btn{min-height:44px;display:inline-grid;place-items:center}
.up-bar{height:3px;border-radius:2px;background:var(--faint2);overflow:hidden}
.up-bar i{display:block;height:100%;width:38%;background:var(--gold);border-radius:2px;animation:upslide 1.5s ease-in-out infinite}
@keyframes upslide{0%{margin-left:-38%}100%{margin-left:100%}}
.up-mock{display:inline-block;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;border:1px solid var(--faint);border-radius:999px;padding:2px 8px;color:var(--dim);margin-left:8px;vertical-align:middle}
@media (max-width:620px){.up-facts{grid-template-columns:1fr;gap:2px}.up-facts dd{margin-bottom:8px}}
`;
    document.head.appendChild(s);
  }

  const esc = (t) => String(t == null ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const when = (iso) => { const d = new Date(iso); if (!iso || isNaN(d)) return ""; const m = Math.round((Date.now() - d) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : d.toLocaleString(); };

  /** What each view says. Plain words, no alarm colours except for a failure; one thing to do at a time. */
  function copy(v) {
    switch (v.kind) {
      case "loading": return { title: "Looking…", text: "" };
      case "no_updater": return { title: "Updates aren’t set up on this server.", text: v.stale ? "The update helper has gone quiet, so nothing can be updated from here. Check that it is running on the server." : "Updating is done by a small helper that runs on your server. Once it is installed, this block does the rest.", small: "Install steps: docs/update.md" };
      case "checking": return { title: "Checking for a newer version…", text: "", busy: true };
      case "up_to_date": return { title: "Up to date.", text: v.note || "", small: v.checkedAt ? "Last checked " + when(v.checkedAt) + "." : "", act: [{ id: "check", label: "Check for updates" }] };
      case "available": return { title: "A newer version is ready.", text: "Version <b>" + esc(v.latest) + "</b>. Your runs are backed up first, and if the new version doesn’t start, the old one comes back by itself.", small: v.blocked, act: [{ id: "update", label: "Update now", primary: true, disabled: !!v.blocked }] };
      case "updating": return { title: "Updating.", text: v.reconnecting ? "Pixelsort is restarting. This page will carry on by itself." : "This takes a minute. Pixelsort will reload when it is done.", small: v.slow ? "This is taking longer than expected. It is still working." : "", busy: true };
      case "done": return { title: "Updated to " + esc(v.version) + ".", text: "Reloading.", };
      case "failed": return v.rollbackFailed
        ? { title: "The update didn’t work, and Pixelsort may not be running properly.", text: "Check the server.", small: v.detail, warn: true }
        : { title: "The update didn’t work.", text: "The previous version is running again, and your runs are as you left them.", small: v.detail, warn: true, act: [{ id: "update", label: "Try again", disabled: !!v.blocked }] };
    }
    return { title: "", text: "" };
  }

  /**
   * host: element to fill. sim: createSim() result (the real app passes a thin client with the same five methods).
   * busy(): { exporting, saving } — read live, so the button re-enables the moment an export ends.
   */
  function mount(o) {
    css();
    const host = o.host, sim = o.sim, busy = o.busy || (() => ({})), toast = o.toast || function () {};
    const st = { info: null, available: null, checkPending: false, updatePending: false, result: null, startedAt: null, startedFromVersion: null,
      runningVersion: null, serverUnreachable: false, pendingClearedAt: null, loadError: "" };
    let timer = null, pollUntil = 0, lastKind = "", actionError = "";

    const view = () => deriveView(Object.assign({}, st, { busy: busy(), now: Date.now() }));

    async function refresh() {
      try {
        st.info = await sim.getVersion();
        const a = await sim.getAvailable(); st.available = a.available; st.checkPending = a.check_pending;
        const s = await sim.getStatus();
        if (st.updatePending && !s.pending && st.pendingClearedAt == null) st.pendingClearedAt = Date.now();
        st.updatePending = s.pending; st.result = s.result; st.runningVersion = st.info.version; st.serverUnreachable = false; st.loadError = "";
      } catch (e) { if (st.startedAt != null) st.serverUnreachable = true; else st.loadError = "Could not reach the server."; }
    }
    async function tick() {
      await refresh(); paint();
      const v = view();
      if (v.kind === "done") { stop(); setTimeout(finishDone, 1500); }
      else if (v.kind === "failed" || Date.now() > pollUntil || (st.startedAt == null && !st.checkPending)) stop();
    }
    function finishDone() { // the real app reloads here; the mock just carries on with the new version
      const v = st.runningVersion; st.startedAt = null; st.startedFromVersion = null; st.result = null; st.pendingClearedAt = null;
      refresh().then(() => { paint(); toast("Updated to " + v); });
    }
    function poll(ms) { pollUntil = Date.now() + ms; clearInterval(timer); timer = setInterval(() => void tick(), o.pollMs || 500); }
    function stop() { clearInterval(timer); timer = null; }

    async function act(id) {
      actionError = "";
      try {
        if (id === "check") { await sim.check(); st.checkPending = true; paint(); poll(60000); }
        else if (id === "update") {
          if (blockReason(busy())) return;
          st.startedFromVersion = st.runningVersion; st.startedAt = Date.now(); st.pendingClearedAt = null; st.result = null; st.updatePending = true;
          paint(); await sim.start(REQUEST_BODY); poll(10 * 60000);
        }
      } catch (e) { st.startedAt = null; st.updatePending = false; actionError = e && e.message ? e.message : "That didn’t go through."; paint(); }
    }

    function paint() {
      const v = view(), c = copy(v), keep = host.contains(document.activeElement) ? document.activeElement.dataset.act : null;
      const facts = '<dl class="up-facts"><dt>Version</dt><dd>' + esc(st.info ? st.info.version : "…") + '</dd><dt>Installed</dt><dd>' + (st.info ? "Docker" : "…") + '</dd><dt>Updates</dt><dd>' +
        (v.kind === "no_updater" ? "not set up" : st.info ? "ready" : "…") + '</dd></dl>';
      const body = st.loadError && st.startedAt == null && !st.info ? '<p class="up-text">' + esc(st.loadError) + '</p>' :
        '<div class="up-card' + (c.warn ? " warn" : "") + '" data-kind="' + v.kind + '"><div class="up-head"><i class="up-dot"></i><div class="up-title">' + c.title + '</div></div>' +
        (c.busy ? '<div class="up-bar" role="progressbar" aria-label="Working"><i></i></div>' : "") +
        (c.text ? '<p class="up-text">' + c.text + '</p>' : "") +
        (c.act ? '<div class="up-act">' + c.act.map((a) => '<button class="btn' + (a.primary ? " pri" : "") + '" data-act="' + a.id + '"' + (a.disabled ? " disabled" : "") + '>' + a.label + '</button>').join("") + '</div>' : "") +
        (c.small ? '<p class="up-small">' + esc(c.small) + '</p>' : "") + (actionError ? '<p class="up-small">' + esc(actionError) + '</p>' : "") + '</div>';
      host.innerHTML = facts + '<div aria-live="polite">' + body + '</div>';
      host.dataset.kind = v.kind;
      host.querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => act(b.dataset.act); });
      if (keep) { const b = host.querySelector('[data-act="' + keep + '"]'); if (b) b.focus(); }
      lastKind = v.kind;
    }

    paint(); refresh().then(paint);
    return { refresh: () => refresh().then(paint), paint, state: st, kind: () => lastKind, stop };
  }

  const api = { STALE_HEARTBEAT_MS, NO_ANSWER_MS, SLOW_MS, VERSION_RE, DIGEST_RE, REQUEST_BODY, short, blockReason, validRequest, staleTab, deriveView, createSim, mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Updater = api;
})(typeof self !== "undefined" ? self : this);
