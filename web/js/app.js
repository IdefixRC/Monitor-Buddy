// The web flasher: its screens, the settings form and every flow (spec §4-6).
// The Buddy's face guides each step; on the settings screen it becomes the
// live preview. Nothing is stored in the browser.
import { S } from "./strings.js";
import { BuddyPort, change, probe } from "./serial.js";
import { romTrouble } from "./protocol.js";
import { fetchImage, flashImage, FlashError, ImageMismatch, WrongBoard } from "./flasher.js";
import { parseManifest, offered, updateFor } from "./releases.js";
import { PAGE_KEYS, mergeConfig, makeBackup, readBackup, backupFileName, BadBackup } from "./settings.js";
import { parseConfigH } from "./configh.js";
import { ruleForZone } from "./tz.js";
import { searchCity } from "./geocode.js";
import { checkStock, checkGithub } from "./checks.js";
import { createFace } from "./face.js";
import { createPreview, THEMES } from "./preview.js";
import {
  DEFAULTS, FLOWS, newFormState, formToRequest, badgesFor, helpFor, wifiChoices, formErrors,
  fieldMessage, fromBoard, redactLog, stockMessage, githubMessage, addsSettings,
  LOCATION_KEYS, boardLocation, escapeRich, parseRich, joinedWifi, resultKind, WIFI_WAIT_MS,
  previewPageFor, locationSummary, locationMissing, afterRecovery,
} from "./form.js";

const params = new URLSearchParams(location.search);
const BETA = params.has("beta");
const SITE_ROOT = new URL("./", location.href);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The hardware, or the pretend Buddy for checking the screens (?fake=a|b).
let dev = { BuddyPort, flashImage };
if (params.has("fake")) dev = (await import("./fake-buddy.js")).fakeDevice(params);
// ?noserial shows the unsupported screen in a browser that has Web Serial.
const SERIAL_OK = !params.has("noserial") && dev.BuddyPort.supported();

const app = {
  manifest: null,
  manifestError: false,
  releases: [],      // what may be installed, newest first
  zones: null,       // the time zone table
  bp: null,          // the BuddyPort
  info: null,        // the last INFO reply; null on path B
  form: null,        // the form, kept across screens so a retry finds it intact
  live: {},          // results of successful checks, for the preview
  expectDrop: false, // a flash or restart is under way: the port going away is expected
  rx: { last: 0, status: false, recent: [] }, // recent: the latest lines, for romTrouble
  trouble: null,     // romTrouble() at connect: the firmware isn't running (path B, recovery)
};
// How long connect listens before it writes anything (E2): a boot loop prints
// every ~40 ms, a running Buddy gets its INFO half a second later.
const LISTEN_MS = 500;

// ── DOM helpers ───────────────────────────────────────────

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : String(kid));
  }
  return e;
}

// strings.js markup -> nodes, through form.js's parseRich. Values from the
// board or a file go in through escapeRich, so they always stay plain text.
function rich(text) {
  return parseRich(text).map((t) => (t.type === "text" ? t.text
    : t.type === "strong" ? h("strong", {}, t.text)
    : t.type === "code" ? h("code", {}, t.text)
    : h("a", { href: t.href, target: "_blank", rel: "noopener" }, t.text)));
}

let uidCount = 0;
const uid = (prefix) => `${prefix}-${++uidCount}`;

const btn = (label, onclick, { kind = "secondary", ...attrs } = {}) =>
  h("button", { type: "button", class: `btn btn--${kind}`, onclick, ...attrs }, label);

// Runs fn with every control on the screen disabled, so nothing starts twice.
async function busy(fn) {
  const controls = [...main.querySelectorAll("button, input, select")].filter((c) => !c.disabled);
  for (const c of controls) c.disabled = true;
  try {
    return await fn();
  } finally {
    for (const c of controls) if (c.isConnected) c.disabled = false;
  }
}

// ── The details log (redacted) ────────────────────────────

const LOG_MAX = 600;
const logLines = [];
let logView = null;

function log(text, tag = "  ") {
  logLines.push(`${new Date().toISOString().slice(11, 23)} ${tag}${redactLog(text)}`);
  if (logLines.length > LOG_MAX) logLines.shift();
  if (logView) {
    logView.textContent = logLines.join("\n");
    logView.scrollTop = logView.scrollHeight;
  }
}

function logPanel() {
  const pre = h("pre", { class: "log__lines", tabindex: "0" });
  pre.textContent = logLines.join("\n");
  logView = pre;
  return h("details", { class: "log" }, h("summary", {}, S.problem.details), pre);
}

function report(err) {
  if (!err) return;
  log(`${err.name || "Error"}: ${err.message || err}`, "! ");
  console.error(err);
}

// ── Screens ───────────────────────────────────────────────

const main = document.getElementById("main");
let cleanups = [];
let firstScreen = true;
let G = null; // the current screen's guide (face and bubble)

function screen(title, build) {
  closeTip();
  while (cleanups.length) {
    try { cleanups.pop()(); } catch (e) { console.error(e); }
  }
  logView = null;
  G = null;
  app.screen = title;
  const heading = h("h1", { class: "sr-only", tabindex: "-1" }, title);
  main.replaceChildren(heading);
  build(main);
  if (firstScreen) { firstScreen = false; return; }
  window.scrollTo(0, 0);
  heading.focus({ preventScroll: true });
}

// The Buddy's face with a speech bubble. g.say() replaces what it says,
// g.add() adds a line, g.mood() changes the face.
function guide(parent, { mood = "normal", say = "", tone = "" } = {}) {
  const faceBox = h("div", { class: "guide__face" });
  const below = h("div", { class: "guide__below" });
  const bubble = h("div", { class: "bubble", "aria-live": "polite" });
  const wrap = h("div", { class: "guide" }, h("div", { class: "guide__buddy" }, faceBox, below), bubble);
  parent.append(wrap);
  const face = createFace(faceBox);
  cleanups.push(() => face.destroy());
  const line = (text, t) => h("p", { class: t ? `bubble__line bubble__line--${t}` : "bubble__line" }, rich(text));
  const g = {
    wrap, below, bubble,
    say(text, t = "") { bubble.replaceChildren(line(text, t)); },
    add(text, t = "") { bubble.append(line(text, t)); },
    mood(m) { face.setMood(m); wrap.dataset.mood = m; },
  };
  g.say(say, tone);
  g.mood(mood);
  G = g;
  return g;
}

const actions = (...kids) => h("div", { class: "actions" }, kids);

function actionCard(title, hint, onclick, { primary = false, disabled = false } = {}) {
  return h("button", { type: "button", class: `action${primary ? " action--primary" : ""}`, onclick, disabled },
    h("span", { class: "action__title" }, title),
    h("span", { class: "action__hint" }, hint));
}

const spinner = () => h("div", { class: "spinner", "aria-hidden": "true" }, h("span"), h("span"), h("span"));

const installable = () => app.releases.length > 0;
const installOff = () => (app.manifestError ? S.start.manifestError : S.start.noRelease);

// ── Leaving during a flash ────────────────────────────────

function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = "";
}
function leaveGuard(on) {
  if (on) window.addEventListener("beforeunload", onBeforeUnload);
  else window.removeEventListener("beforeunload", onBeforeUnload);
}

// ── Start ─────────────────────────────────────────────────

function showStart() {
  screen(S.titles.start, (m) => {
    if (!SERIAL_OK) {
      guide(m, { mood: "sad", say: S.unsupported });
      return;
    }
    const g = guide(m, { mood: "normal", say: S.start.say });
    if (!installable()) g.add(installOff(), "error");
    m.append(
      h("div", { class: "actions actions--start" },
        btn(S.connect, () => connect(), { kind: "primary", class: "btn btn--primary btn--big" })),
      h("p", { class: "hint hint--center" }, S.start.cable),
    );
    if (installable()) m.append(h("p", { class: "hint hint--center" }, S.start.newest(app.releases[0].version)));
  });
}

async function startOver() {
  app.expectDrop = false;
  leaveGuard(false);
  if (app.bp) {
    try { await app.bp.close(); } catch { /* already gone */ }
  }
  app.bp = null;
  app.info = null;
  app.form = null;
  app.live = {};
  showStart();
}

// ── Connect ───────────────────────────────────────────────

const attached = new WeakSet();
function attach(bp) {
  if (attached.has(bp)) return;
  attached.add(bp);
  bp.onLine((line, dir) => {
    if (dir === "rx") {
      app.rx.last = Date.now();
      if (/^app=/.test(line)) app.rx.status = true;
      app.rx.recent.push(line);
      if (app.rx.recent.length > 100) app.rx.recent.shift();
    }
    log(line, dir === "tx" ? ">> " : "<< ");
  });
  bp.onError((e) => {
    log(`the port failed: ${e && e.message}`, "* ");
    if (!app.expectDrop) showProblem(S.connecting.lost, null, { retry: connect, retryLabel: S.connect });
  });
}

let picking = false;
async function connect() {
  if (picking) return; // a double click opens one picker
  picking = true;
  let bp;
  try {
    bp = await dev.BuddyPort.pick();
  } catch (e) {
    // Cancelled: back to Start, without a word.
    if (e && (e.name === "NotFoundError" || e.name === "AbortError")) {
      if (app.screen !== S.titles.start) showStart();
      return;
    }
    return showProblem(S.connecting.openFailed, e);
  } finally {
    picking = false;
  }
  if (app.bp && app.bp !== bp) {
    try { await app.bp.close(); } catch { /* already gone */ }
  }
  app.bp = bp;
  attach(bp);
  await probeAndRoute();
}

// Opens the port and asks INFO: an answer is path A, none is path B.
let probing = false;
async function probeAndRoute() {
  if (probing) return;
  probing = true;
  try {
    await probeAndRouteOnce();
  } finally {
    probing = false;
  }
}

async function probeAndRouteOnce() {
  const bp = app.bp;
  let g;
  screen(S.titles.connecting, (m) => {
    g = guide(m, { mood: "curious", say: S.connecting.say });
    m.append(spinner());
  });
  try {
    await bp.open();
  } catch (e) {
    const busyPort = e && (e.name === "NetworkError" || e.name === "InvalidStateError");
    return showProblem(busyPort ? S.connecting.portBusy : S.connecting.openFailed, e, { retry: probeAndRoute });
  }
  // Look before writing (E2): a board that isn't running the firmware never
  // reads, so even one INFO would stay stuck and keep the port from closing
  // until a replug. Then the flash couldn't open it.
  app.rx.recent = [];
  await sleep(LISTEN_MS);
  app.trouble = romTrouble(app.rx.recent);
  if (app.trouble) {
    log(`no firmware running (${app.trouble}): nothing sent`, "* ");
    app.info = null;
    return showPathB();
  }
  let info = null;
  app.rx.status = false;
  try {
    info = await probe(bp, app.rx, { onBooting: () => g.say(S.connecting.booting) });
  } catch (e) {
    return showProblem(S.connecting.lost, e, { retry: connect, retryLabel: S.connect });
  }
  app.info = info;
  if (info) bp.mac = info.mac || ""; // from now on, only this board is accepted
  if (info) showHome();
  else showPathB();
}

async function infoOnce() {
  try {
    const r = await app.bp.command("INFO");
    return r && r.ok ? r : null;
  } catch {
    return null;
  }
}

// GET, or the problem screen. Resolves the reply or null.
async function readGet() {
  if (G) { G.mood("curious"); G.say(S.connecting.reading); }
  try {
    const r = await app.bp.command("GET");
    if (r && r.ok && r.config) return r;
    throw new Error(r && r.error ? r.error : "GET failed");
  } catch (e) {
    showProblem(S.connecting.readFailed, e, { retry: backHome, retryLabel: S.backup.back });
    return null;
  }
}

// ── Path A: home ──────────────────────────────────────────

function showHome() {
  const info = app.info;
  if (!info) return showPathB();
  const upd = app.manifest ? updateFor(info.fw, app.manifest, BETA) : null;
  screen(S.titles.home, (m) => {
    const g = guide(m, { mood: "happy", say: S.home.say(escapeRich(info.fw)) });
    if (!installable()) g.add(installOff(), "error");
    const w = info.wifi || {};
    const wifiText = !w.saved ? S.home.wifiNone : w.connected ? S.home.wifiUp(w.ssid) : S.home.wifiDown(w.ssid);
    const wifiState = !w.saved ? "none" : w.connected ? "up" : "down";
    m.append(h("dl", { class: "status" },
      h("div", { class: "status__item" }, h("dt", {}, S.home.firmware),
        h("dd", {}, info.fw, !upd && installable() ? h("span", { class: "pill pill--ok" }, S.home.upToDate) : null)),
      h("div", { class: "status__item" }, h("dt", {}, S.home.wifi),
        h("dd", {}, h("span", { class: `dot dot--${wifiState}`, "aria-hidden": "true" }), wifiText))));
    if (upd) {
      m.append(h("p", { class: "ribbon" }, h("strong", {}, S.home.update(upd.version)),
        addsSettings(upd, info) ? h("span", { class: "ribbon__note" }, S.addsSettings) : null));
    }
    m.append(h("div", { class: "action-grid" },
      actionCard(S.home.change, S.home.changeHint, () => busy(startChange), { primary: !upd }),
      actionCard(S.home.updateFw, S.home.updateHint, () => busy(() => startFlashFlow("update")), { primary: !!upd, disabled: !installable() }),
      actionCard(S.home.fresh, S.home.freshHint, () => busy(startFresh), { disabled: !installable() }),
      actionCard(S.home.backup, S.home.backupHint, () => busy(startBackup))));
    m.append(h("div", { class: "actions actions--small" },
      btn(S.home.reset, () => busy(startReset), { kind: "link" }),
      btn(S.home.disconnect, startOver, { kind: "link" })));
  });
}

async function startChange() {
  const got = await readGet();
  if (!got) return;
  app.form = newFormState(fromBoard(got.config), { flow: "change", info: app.info, added: got.added || [] });
  showForm();
}

// Update (path A) or, from path B, upgrade and install.
async function startFlashFlow(flow) {
  let config = DEFAULTS;
  let added = [];
  if (app.info) {
    const got = await readGet();
    if (!got) return;
    config = fromBoard(got.config);
    added = got.added || [];
  }
  app.form = newFormState(config, { flow, info: app.info, added });
  app.form.version = app.releases[0].version;
  showForm();
}

// A Buddy that can't start (app.trouble): reinstall the newest firmware
// straight away, without the form. Whether its saved settings survived only
// shows after the flash (afterFlash, afterRecovery).
async function startRecovery() {
  app.form = newFormState(DEFAULTS, { flow: "recover" });
  app.form.version = app.releases[0].version;
  await runFlash();
}

async function startBackup() {
  const got = await readGet();
  if (!got) return;
  const name = downloadBackup(fromBoard(got.config));
  showHome();
  G.add(S.backup.saved(escapeRich(name)));
}

function downloadBackup(config) {
  const now = new Date();
  const name = backupFileName(now);
  const fw = app.info ? app.info.fw : "";
  const data = `${JSON.stringify(makeBackup(config, fw, now), null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

// The "back up first" screen for a fresh install and a reset.
function showBackupOffer({ say, config, choice, next }) {
  screen(S.titles.backup, (m) => {
    const g = guide(m, { mood: "curious", say });
    let empty = false;
    if (choice) {
      const name = uid("start");
      const opt = (value, label) => h("label", { class: "choice" },
        h("input", { type: "radio", name, value, checked: value === "keep", onchange: () => { empty = value === "empty"; } }),
        h("span", {}, label));
      m.append(h("fieldset", { class: "card choices" },
        h("legend", {}, S.backup.startLegend),
        opt("keep", S.backup.keepCurrent), opt("empty", S.backup.startEmpty)));
    }
    m.append(
      h("p", { class: "hint" }, S.backup.warning),
      actions(
        btn(S.backup.download, () => { g.add(S.backup.saved(escapeRich(downloadBackup(config)))); }),
        btn(S.backup.continue, () => next(empty), { kind: "primary" }),
        btn(S.backup.back, showHome, { kind: "link" })));
  });
}

async function startFresh() {
  const got = await readGet();
  if (!got) return;
  showBackupOffer({
    say: S.backup.freshSay,
    config: fromBoard(got.config),
    choice: true,
    next: (empty) => {
      app.form = newFormState(empty ? DEFAULTS : fromBoard(got.config),
        { flow: "fresh", info: app.info, location: empty ? [] : boardLocation(got) });
      app.form.version = app.releases[0].version;
      showForm();
    },
  });
}

async function startReset() {
  const got = await readGet();
  if (!got) return;
  showBackupOffer({ say: S.backup.resetSay, config: fromBoard(got.config), choice: false, next: showResetConfirm });
}

function showResetConfirm() {
  screen(S.titles.reset, (m) => {
    guide(m, { mood: "suspicious", say: S.reset.say });
    m.append(actions(
      btn(S.reset.confirm, () => doReset(), { kind: "danger" }),
      btn(S.backup.back, showHome, { kind: "link" })));
  });
}

async function doReset() {
  screen(S.titles.reset, (m) => {
    guide(m, { mood: "curious", say: S.reset.working });
    m.append(spinner(), logPanel());
  });
  app.expectDrop = true;
  let res;
  try {
    res = await change(app.bp, "DEFAULTS", null, { waitRestart: true });
  } catch (e) {
    // DEFAULTS answered ok, so the reset happened; only the reconnect failed.
    report(e);
    app.expectDrop = false;
    return showProblem(S.reset.noComeBack, null, { retry: () => backHome(), retryLabel: S.problem.retry });
  }
  app.expectDrop = false;
  if (!res.ok) {
    if (res.note) log(res.note, "* ");
    if (res.reply && res.reply.error) log(`DEFAULTS: ${res.reply.error}`, "* ");
    // A refusal means nothing changed; no reply at all means we can't tell.
    const text = res.reply ? S.reset.refused : S.reset.unconfirmed;
    return showProblem(text, null, { retry: () => backHome(), retryLabel: S.backup.back });
  }
  const info = await infoOnce();
  if (info) app.info = info;
  showResult("reset");
}

// Home with fresh INFO: after a restart the old one is stale. Reconnects
// first when the port went away.
async function backHome() {
  screen(S.titles.connecting, (m) => {
    guide(m, { mood: "curious", say: S.connecting.say });
    m.append(spinner());
  });
  app.expectDrop = true;
  let info = await infoOnce();
  if (!info) {
    try { info = await app.bp.reconnect(20000); } catch (e) { report(e); }
  }
  app.expectDrop = false;
  if (!info) return showProblem(S.connecting.lost, null, { retry: connect, retryLabel: S.connect });
  app.info = info;
  showHome();
}

// ── Path B ────────────────────────────────────────────────

function showPathB() {
  // The same choices for a Buddy whose firmware didn't finish installing.
  const recover = !!app.trouble;
  screen(recover ? S.titles.recover : S.titles.pathB, (m) => {
    const say = !recover ? S.pathB.say : app.trouble === "download" ? S.pathB.downloadSay : S.pathB.recoverSay;
    const g = guide(m, { mood: recover ? "sad" : "curious", say });
    if (!installable()) g.add(installOff(), "error");
    m.append(h("div", { class: "action-grid action-grid--two" },
      actionCard(recover ? S.pathB.reinstall : S.pathB.upgrade, recover ? S.pathB.reinstallHint : S.pathB.upgradeHint,
        () => (recover ? startRecovery() : startFlashFlow("upgrade")), { primary: true, disabled: !installable() }),
      actionCard(S.pathB.fresh, S.pathB.freshHint, () => startFlashFlow("install"), { disabled: !installable() })));
    m.append(h("div", { class: "actions actions--small" },
      btn(S.pathB.retry, probeAndRoute, { kind: "link" }),
      btn(S.home.disconnect, startOver, { kind: "link" })));
  });
}

// ── Help toggletips ───────────────────────────────────────
// Open on hover, focus and click or tap; stay open while the pointer is over
// the button or the bubble; Esc, a click outside or focus leaving closes it.
// One at a time.

let tip = null; // { button, bubble, pinned, at }
let tipTimer = 0;
let tipQuiet = false; // focus moving back to the button after Esc doesn't reopen it

function placeTip() {
  if (!tip) return;
  const { button, bubble } = tip;
  const r = button.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = Math.min(320, vw - 32);
  bubble.style.width = `${width}px`;
  const left = Math.max(16, Math.min(r.left + r.width / 2 - width / 2, vw - 16 - width));
  bubble.style.left = `${left}px`;
  const height = bubble.offsetHeight;
  let top = r.bottom + 10;
  let below = true;
  if (top + height > vh - 8 && r.top - 10 - height >= 8) { top = r.top - 10 - height; below = false; }
  bubble.style.top = `${top}px`;
  bubble.dataset.side = below ? "below" : "above";
  bubble.style.setProperty("--arrow-x", `${Math.round(r.left + r.width / 2 - left)}px`);
}

function openTip(button, bubble, pinned = false) {
  clearTimeout(tipTimer);
  if (tip && tip.button !== button) closeTip();
  if (!tip) {
    tip = { button, bubble, pinned, at: Date.now() };
    bubble.hidden = false;
    button.setAttribute("aria-expanded", "true");
    placeTip();
  } else if (pinned) {
    tip.pinned = true;
  }
}

function closeTip() {
  clearTimeout(tipTimer);
  if (!tip) return;
  tip.bubble.hidden = true;
  tip.button.setAttribute("aria-expanded", "false");
  tip = null;
}

function closeTipSoon() {
  clearTimeout(tipTimer);
  if (!tip || tip.pinned) return;
  tipTimer = setTimeout(closeTip, 250);
}

function helpButton(key, label) {
  const id = uid("help");
  const button = h("button", {
    type: "button", class: "help", "aria-label": S.form.about(label), "aria-expanded": "false", "aria-controls": id,
  }, "?");
  const bubble = h("div", { class: "tip", role: "tooltip", id, hidden: true }, rich(helpFor(key)));
  button.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") openTip(button, bubble); });
  button.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") closeTipSoon(); });
  bubble.addEventListener("pointerenter", () => clearTimeout(tipTimer));
  bubble.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") closeTipSoon(); });
  button.addEventListener("focus", () => { if (!tipQuiet) openTip(button, bubble); });
  button.addEventListener("blur", (e) => { if (!bubble.contains(e.relatedTarget)) closeTip(); });
  bubble.addEventListener("focusout", (e) => {
    if (e.relatedTarget !== button && !bubble.contains(e.relatedTarget)) closeTip();
  });
  button.addEventListener("click", () => {
    // A tap focuses (opens) and clicks in one go: that click pins it open.
    if (!tip || tip.button !== button) openTip(button, bubble, true);
    else if (!tip.pinned || Date.now() - tip.at < 400) tip.pinned = true;
    else closeTip();
  });
  return [button, bubble];
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !tip) return;
  const { button, bubble } = tip;
  const inside = bubble.contains(document.activeElement);
  closeTip();
  if (inside) {
    tipQuiet = true;
    button.focus({ preventScroll: true });
    tipQuiet = false;
  }
});
document.addEventListener("pointerdown", (e) => {
  if (tip && !tip.button.contains(e.target) && !tip.bubble.contains(e.target)) closeTip();
});
window.addEventListener("resize", placeTip);
window.addEventListener("scroll", placeTip, { passive: true, capture: true });

// ── The settings form ─────────────────────────────────────

// The single-column layout, where the preview becomes a compact strip. KEEP
// IN SYNC with the max-width of the form-layout media query in app.css.
const NARROW = "(max-width: 900px)";

function showForm({ say: message = "", tone = "", focus } = {}) {
  const f = app.form;
  const flow = FLOWS[f.flow];
  const choices = wifiChoices(app.info, f.flow);
  if (!choices.some((c) => c.value === f.wifi.choice)) f.wifi.choice = choices[0].value;
  f.touched = f.touched || new Set();
  f.serverErrors = f.serverErrors || {};
  f.submitted = !!f.submitted;

  const slots = new Map();   // error key -> { error, inputs }
  const badgeSlots = [];     // [key, element]
  const refreshers = [];     // run on every change
  let currentErrors = {};
  let preview;
  let bubble;
  // False once this drawing of the form is gone (redrawn or left), so a check
  // or an import that finishes late doesn't touch a destroyed preview.
  let alive = true;
  f.location = f.location || [];

  const touch = (key) => { f.touched.add(key); delete f.serverErrors[key]; };
  const gave = (...keys) => { f.location = [...new Set([...f.location, ...keys])]; touch("location"); };
  // The preview jumps to the page a changed setting affects and holds it there
  // (previewPageFor; the hold and resume live in preview.js).
  const jumpFor = (key) => {
    const target = previewPageFor(key, f.config);
    if (target && preview && alive) preview.showPage(target === "stay" ? null : target);
  };
  const changed = (key) => { if (key) touch(key); refresh(); if (key) jumpFor(key); };

  // A label row: the label, its help button and its badges.
  function head(labelEl, labelText, helpKey, badgeKey) {
    const badges = h("span", { class: "badges" });
    if (badgeKey) badgeSlots.push([badgeKey, badges]);
    return h("div", { class: "field__head" }, labelEl, helpKey ? helpButton(helpKey, labelText) : null, badges);
  }

  function errorSlot(key, inputs) {
    const error = h("p", { class: "field__error", id: uid("err"), hidden: true });
    slots.set(key, { error, inputs });
    for (const i of inputs) i.setAttribute("aria-describedby", [i.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
    return error;
  }

  function textField({ key, label, help, value, hint, set, type = "text", attrs = {}, extra = null }) {
    const id = uid("f");
    const hintEl = hint ? h("p", { class: "field__hint", id: uid("hint") }, rich(hint)) : null;
    const input = h("input", {
      id, type, class: "input", autocomplete: "off", spellcheck: "false",
      autocapitalize: "off", "aria-describedby": hintEl ? hintEl.id : null, ...attrs,
    });
    input.value = value ?? ""; // a property: the password and the key never land in the DOM's attributes
    input.addEventListener("input", () => { set(input.value, input); changed(key); });
    const error = errorSlot(key, [input]);
    const control = extra ? h("div", { class: "input-row" }, input, extra) : input;
    return { input, el: h("div", { class: "field" }, head(h("label", { for: id }, label), label, help, key), control, hintEl, error) };
  }

  function radioGroup({ key, legend, help, options, value, set, cls = "" }) {
    const name = uid("r");
    const inputs = [];
    const items = options.map(([v, label, deco]) => {
      const input = h("input", { type: "radio", name, value: String(v), checked: v === value });
      input.addEventListener("change", () => { if (input.checked) { set(v); changed(key); } });
      inputs.push(input);
      return h("label", { class: "choice" }, input, deco || null, h("span", { class: "choice__text" }, label));
    });
    const error = errorSlot(key, inputs);
    return h("fieldset", { class: `field radios ${cls}` },
      h("legend", {}, head(h("span", {}, legend), legend, help, key)),
      h("div", { class: "radios__items" }, items), error);
  }

  function switchRow({ label, checked, set, help, badgeKey, errorKey }) {
    const id = uid("s");
    const input = h("input", { type: "checkbox", role: "switch", id, class: "switch", checked });
    input.addEventListener("change", () => { set(input.checked); changed(errorKey); });
    const error = errorKey ? errorSlot(errorKey, [input]) : null;
    return { input, el: h("div", { class: "switch-row" }, head(h("label", { for: id }, label), label, help, badgeKey), input, error) };
  }

  const section = (title, ...kids) => h("section", { class: "section" }, h("h2", { class: "section__title" }, title), kids);
  const note = (text, cls = "") => h("p", { class: `note ${cls}` }, rich(text));

  screen(S.titles.form, (m) => {
    // The side column: the live preview and the Buddy's bubble.
    const previewBox = h("div", { class: "form-side__preview" });
    bubble = h("div", { class: "bubble bubble--up", "aria-live": "polite" });
    const side = h("aside", { class: "form-side" }, h("div", { class: "form-side__sticky" }, previewBox, bubble));
    const form = h("form", { class: "settings", novalidate: true });
    m.append(h("div", { class: "form-layout" }, side, form));
    preview = createPreview(previewBox);
    // Phones get the compact sticky strip; its height sets the scroll padding,
    // so a focused field never hides behind it.
    const narrow = matchMedia(NARROW);
    const fit = () => preview.setCompact(narrow.matches);
    fit();
    narrow.addEventListener("change", fit);
    const measure = () => document.documentElement.style.setProperty("--strip-h", `${previewBox.offsetHeight}px`);
    const ro = new ResizeObserver(measure);
    ro.observe(previewBox);
    window.addEventListener("resize", measure);
    measure();
    cleanups.push(() => {
      alive = false;
      narrow.removeEventListener("change", fit);
      window.removeEventListener("resize", measure);
      ro.disconnect();
      // The strip is gone: its scroll padding must not outlive the form.
      document.documentElement.style.removeProperty("--strip-h");
      preview.destroy();
    });
    const say = (text, t = "") => bubble.replaceChildren(h("p", { class: t ? `bubble__line bubble__line--${t}` : "bubble__line" }, rich(text)));
    say(message || S.form.say[f.flow], tone);

    // Import and export.
    const status = h("p", { class: "tools__status", "aria-live": "polite" });
    const fileConfig = h("input", { type: "file", accept: ".h,text/plain,text/x-c", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
    const fileBackup = h("input", { type: "file", accept: ".json,application/json", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
    fileConfig.addEventListener("change", () => importConfigH(fileConfig));
    fileBackup.addEventListener("change", () => importBackup(fileBackup));
    const upgrade = f.flow === "upgrade";
    form.append(h("section", { class: `tools${upgrade ? " tools--callout" : ""}` },
      upgrade ? h("p", { class: "tools__callout" }, S.form.upgradeCallout) : h("h2", { class: "sr-only" }, S.form.tools),
      h("div", { class: "tools__buttons" },
        btn(S.form.importConfig, () => fileConfig.click(), { kind: upgrade ? "primary" : "secondary" }),
        btn(S.form.importBackup, () => fileBackup.click()),
        btn(S.form.exportBackup, () => { status.replaceChildren(...rich(S.backup.saved(escapeRich(downloadBackup(f.config))))); })),
      fileConfig, fileBackup, status));

    // 1. Wi-Fi.
    const configure = switchRow({
      label: S.form.wifiConfigure, help: "wifi.configure", checked: f.wifi.configure,
      set: (v) => { f.wifi.configure = v; },
    });
    const ssid = textField({
      key: "wifi.ssid", label: S.form.ssid, help: "wifi.ssid", value: f.wifi.ssid, hint: S.form.band,
      set: (v) => { f.wifi.ssid = v; },
    });
    const showPw = h("button", { type: "button", class: "btn btn--secondary btn--inline", "aria-pressed": "false" }, S.form.showPassword);
    const password = textField({
      key: "wifi.password", label: S.form.password, help: "wifi.password", value: f.wifi.password, type: "password",
      hint: S.form.passwordHint, set: (v) => { f.wifi.password = v; }, extra: showPw,
      attrs: { autocomplete: "off", "data-lpignore": "true" },
    });
    showPw.setAttribute("aria-controls", password.input.id);
    showPw.addEventListener("click", () => {
      const show = password.input.type === "password";
      password.input.type = show ? "text" : "password";
      showPw.setAttribute("aria-pressed", String(show));
    });
    const creds = h("div", { class: "creds" }, ssid.el, password.el);
    let choiceGroup = null;
    if (choices.length > 1) {
      const name = uid("wifi");
      choiceGroup = h("fieldset", { class: "field radios radios--stack" },
        h("legend", { class: "sr-only" }, S.form.wifiChoice),
        h("div", { class: "radios__items" }, choices.map((c) => {
          const input = h("input", { type: "radio", name, value: c.value, checked: c.value === f.wifi.choice });
          input.addEventListener("change", () => { if (input.checked) { f.wifi.choice = c.value; refresh(); } });
          return h("div", { class: "choice-row" },
            h("label", { class: "choice" }, input, h("span", { class: "choice__text" }, c.label)),
            c.value === "keep" ? helpButton("wifi.keep", c.label) : null);
        })));
    }
    const offSaved = !flow.erase && (app.info ? !!(app.info.wifi && app.info.wifi.saved) : f.flow === "upgrade");
    const offNote = note(offSaved ? S.form.offKeep : S.form.offHotspot);
    const onBox = h("div", { class: "wifi-on" }, choiceGroup, creds);
    form.append(section(S.form.sections.wifi, configure.el, onBox, offNote));
    refreshers.push(() => {
      onBox.hidden = !f.wifi.configure;
      offNote.hidden = f.wifi.configure;
      creds.hidden = f.wifi.choice !== "new";
    });

    // 2. Location.
    const cityId = uid("city");
    const cityInput = h("input", { id: cityId, type: "search", class: "input", placeholder: S.form.cityPlaceholder, autocomplete: "off", spellcheck: "false" });
    const searchBtn = btn(S.form.search, () => doSearch());
    const cityStatus = h("p", { class: "field__hint", "aria-live": "polite" });
    const results = h("ul", { class: "places", "aria-label": S.form.results, hidden: true });
    cityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
    async function doSearch() {
      const q = cityInput.value.trim();
      if (!q) { cityInput.focus(); return; }
      cityStatus.textContent = S.form.searching;
      results.hidden = true;
      searchBtn.disabled = true;
      try {
        const found = await searchCity(window.fetch.bind(window), q);
        results.replaceChildren(...found.map((r) => h("li", {},
          h("button", { type: "button", class: "place", onclick: () => pick(r) },
            h("span", { class: "place__name" }, r.label),
            h("span", { class: "place__tz" }, r.tz)))));
        results.hidden = !found.length;
        cityStatus.textContent = found.length ? "" : S.form.noPlaces(q);
      } catch (e) {
        report(e);
        cityStatus.textContent = S.form.searchFailed;
      } finally {
        searchBtn.disabled = false;
      }
    }
    function pick(r) {
      f.config.lat = r.lat;
      f.config.lon = r.lon;
      f.config.tz_name = r.tz;
      const rule = app.zones ? ruleForZone(app.zones, r.tz) : null;
      if (rule) f.config.tz_rule = rule;
      lat.input.value = r.lat;
      lon.input.value = r.lon;
      tz.input.value = r.tz;
      tzRule.input.value = f.config.tz_rule;
      for (const k of ["lat", "lon", "tz_name", "tz_rule"]) touch(k);
      gave(...LOCATION_KEYS);
      f.placeLabel = r.label; // the summary line names the place
      results.hidden = true;
      cityStatus.textContent = ""; // the summary line below says where, and is announced
      cityInput.focus();
      refresh();
      jumpFor("city");
    }
    const cityField = h("div", { class: "field" },
      head(h("label", { for: cityId }, S.form.city), S.form.city, "city"),
      h("div", { class: "input-row" }, cityInput, searchBtn), cityStatus, results,
      errorSlot("location", [cityInput])); // a fresh install needs a place
    const coord = (v) => v.trim();
    const lat = textField({ key: "lat", label: S.form.lat, help: "lat", value: f.config.lat, set: (v) => { f.config.lat = coord(v); gave("lat"); f.placeLabel = ""; }, attrs: { inputmode: "decimal" } });
    const lon = textField({ key: "lon", label: S.form.lon, help: "lon", value: f.config.lon, set: (v) => { f.config.lon = coord(v); gave("lon"); f.placeLabel = ""; }, attrs: { inputmode: "decimal" } });
    const zonesList = h("datalist", { id: uid("zones") }, Object.keys(app.zones || {}).map((z) => h("option", { value: z })));
    const tz = textField({
      key: "tz_name", label: S.form.tz, help: "tz_name", value: f.config.tz_name, attrs: { list: zonesList.id },
      set: (v) => {
        f.config.tz_name = v.trim();
        gave("tz_name");
        f.placeLabel = ""; // edited by hand: no longer just what the city search found
        const rule = app.zones ? ruleForZone(app.zones, f.config.tz_name) : null;
        if (rule) { f.config.tz_rule = rule; tzRule.input.value = rule; }
      },
    });
    const tzRule = textField({ key: "tz_rule", label: S.form.tzRule, help: "tz_rule", value: f.config.tz_rule, set: (v) => { f.config.tz_rule = v.trim(); } });
    // The four values the city search fills sit in a disclosure, closed by
    // default; a one-line summary under the search shows what is set. An
    // error inside opens it, and it stays open while the error is shown.
    const summaryLine = h("p", { class: "place-summary", "aria-live": "polite" });
    const advanced = h("details", { class: "advanced" },
      h("summary", { class: "advanced__summary" },
        h("span", { class: "advanced__title" }, S.form.advanced),
        h("span", { class: "advanced__hint" }, S.form.advancedHint)),
      h("div", { class: "advanced__body" },
        h("div", { class: "grid-2" }, lat.el, lon.el), tz.el, zonesList, tzRule.el));
    const advancedKeys = ["lat", "lon", "tz_name", "tz_rule"];
    const advancedError = () => advancedKeys.some((k) => slots.get(k) && !slots.get(k).error.hidden);
    advanced.addEventListener("toggle", () => {
      if (!advanced.open && advancedError()) advanced.open = true; // keep the error in sight
    });
    form.append(section(S.form.sections.location, cityField, summaryLine, advanced));
    refreshers.push(() => {
      // While a fresh install still needs a place, the built-in one must not
      // look chosen, so the line stays empty until the user gives one.
      const text = locationMissing(f) ? "" : locationSummary(f.config, f.placeLabel);
      summaryLine.hidden = !text;
      summaryLine.textContent = text; // board and file values stay plain text
      if (advancedError()) advanced.open = true;
    });

    // 3. Units.
    form.append(section(S.form.sections.units, h("div", { class: "grid-2" },
      radioGroup({ key: "temp_unit", legend: S.form.temp, help: "temp_unit", value: f.config.temp_unit,
        options: [["celsius", S.form.celsius], ["fahrenheit", S.form.fahrenheit]], set: (v) => { f.config.temp_unit = v; } }),
      radioGroup({ key: "wind_unit", legend: S.form.wind, help: "wind_unit", value: f.config.wind_unit,
        options: [["kmh", S.form.kmh], ["mph", S.form.mph]], set: (v) => { f.config.wind_unit = v; } }))));

    // 4. Pages.
    const pageRows = PAGE_KEYS.map((p) => switchRow({
      label: S.pageNames[p], checked: !!(f.config.pages && f.config.pages[p]), badgeKey: `pages.${p}`, errorKey: `pages.${p}`,
      set: (v) => { f.config.pages = { ...f.config.pages, [p]: v }; },
    }));
    const allOff = note(S.form.allOff, "note--info");
    const stockHidden = note(S.form.stockHidden, "note--info");
    const githubHidden = note(S.form.githubHidden, "note--info");
    // The legend is the section's title, so the help button sits next to it.
    form.append(h("section", { class: "section" },
      h("fieldset", { class: "field pages" },
        h("legend", { class: "section__legend" }, head(h("h2", { class: "section__title" }, S.form.pages), S.form.pages, "pages", "pages")),
        h("div", { class: "pages__grid" }, pageRows.map((r) => r.el)),
        errorSlot("pages", [])),
      allOff, stockHidden, githubHidden));
    refreshers.push(() => {
      const pages = f.config.pages || {};
      allOff.hidden = PAGE_KEYS.some((p) => pages[p]);
      stockHidden.hidden = !(pages.stock && !f.config.stock_key);
      githubHidden.hidden = !(pages.github && !f.config.github_user);
    });

    // 5. Stock.
    const stockResult = h("p", { class: "check__result", "aria-live": "polite" });
    const stockCheck = btn(S.form.check, async () => {
      stockResult.textContent = S.check.checking;
      stockResult.dataset.state = "";
      stockCheck.disabled = true;
      jumpFor("check.stock"); // show the stock page while it checks
      const asked = [f.config.ticker, f.config.stock_key];
      const res = await checkStock(window.fetch.bind(window), ...asked);
      // Gone, or the ticker or key changed while it ran: the answer is stale.
      if (!alive || asked[0] !== f.config.ticker || asked[1] !== f.config.stock_key) return;
      stockCheck.disabled = false;
      stockResult.textContent = stockMessage(res, f.config.ticker);
      stockResult.dataset.state = res.status === "ok" ? "ok" : "bad";
      if (res.status === "ok") app.live = { ...app.live, price: res.price };
      refresh();
      jumpFor("check.stock"); // a fresh result: hold the page again, with the live price on it
    });
    const stockOff = h("p", { class: "field__hint" }, S.form.stockCheckOff);
    const clearStock = () => { delete app.live.price; stockResult.textContent = ""; };
    const ticker = textField({
      key: "ticker", label: S.form.ticker, help: "ticker", value: f.config.ticker,
      attrs: { autocapitalize: "characters", class: "input input--upper" },
      set: (v, input) => {
        const up = v.toUpperCase().trim();
        if (input.value !== up) {
          const at = input.selectionStart;
          input.value = up;
          try { input.setSelectionRange(at, at); } catch { /* not every input type allows it */ }
        }
        f.config.ticker = up;
        clearStock();
      },
    });
    const stockKey = textField({
      key: "stock_key", label: S.form.stockKey, help: "stock_key", value: f.config.stock_key, hint: S.form.stockEmpty,
      set: (v) => { f.config.stock_key = v.trim(); clearStock(); },
    });
    form.append(section(S.form.sections.stock, h("div", { class: "grid-2 grid-2--narrow-first" }, ticker.el, stockKey.el),
      h("div", { class: "check" }, stockCheck, stockOff, stockResult)));
    refreshers.push(() => {
      const off = !f.config.ticker || !f.config.stock_key;
      stockCheck.disabled = off;
      stockOff.hidden = !off;
    });

    // 6. GitHub.
    const ghResult = h("p", { class: "check__result", "aria-live": "polite" });
    const ghCheck = btn(S.form.check, async () => {
      ghResult.textContent = S.check.checking;
      ghResult.dataset.state = "";
      ghCheck.disabled = true;
      jumpFor("check.github");
      const asked = f.config.github_user;
      const res = await checkGithub(window.fetch.bind(window), asked);
      if (!alive || asked !== f.config.github_user) return;
      ghCheck.disabled = false;
      ghResult.textContent = githubMessage(res);
      ghResult.dataset.state = res.status === "ok" ? "ok" : "bad";
      if (res.status === "ok") app.live = { ...app.live, followers: res.followers, repos: res.repos };
      refresh();
      jumpFor("check.github");
    });
    const ghOff = h("p", { class: "field__hint" }, S.form.githubCheckOff);
    const github = textField({
      key: "github_user", label: S.form.githubUser, help: "github_user", value: f.config.github_user, hint: S.form.githubEmpty,
      set: (v) => {
        f.config.github_user = v.trim();
        delete app.live.followers;
        delete app.live.repos;
        ghResult.textContent = "";
      },
    });
    form.append(section(S.form.sections.github, github.el, h("div", { class: "check" }, ghCheck, ghOff, ghResult)));
    refreshers.push(() => {
      ghCheck.disabled = !f.config.github_user;
      ghOff.hidden = !!f.config.github_user;
    });

    // 7. Look.
    const swatch = (i) => {
      const t = THEMES[i];
      const dots = [...new Set([t.sec, t.temp, t.priceUp, t.priceDown, t.ghNum])].slice(0, 4);
      return h("span", { class: "swatch", "aria-hidden": "true" },
        h("span", { class: "swatch__time", style: `color:${t.time}` }, "12:34"),
        h("span", { class: "swatch__dots" }, dots.map((c) => h("i", { style: `background:${c}` }))));
    };
    const mountIcon = (side) => h("span", { class: `mount-icon mount-icon--${side}`, "aria-hidden": "true" }, h("i"), h("b"));
    form.append(section(S.form.sections.look,
      radioGroup({ key: "theme", legend: S.form.theme, help: "theme", value: f.config.theme, cls: "radios--swatches",
        options: S.themeNames.map((name, i) => [i, name, swatch(i)]), set: (v) => { f.config.theme = v; } }),
      radioGroup({ key: "mount", legend: S.form.mount, help: "mount", value: f.config.mount, cls: "radios--mount",
        options: [["left", S.form.left, mountIcon("left")], ["right", S.form.right, mountIcon("right")]],
        set: (v) => { f.config.mount = v; } })));

    // Firmware version, for the flows that flash.
    let cfgNote = null;
    if (flow.flash) {
      const id = uid("ver");
      const select = h("select", { id, class: "input" }, app.releases.map((e) =>
        h("option", { value: e.version, selected: e.version === f.version }, S.form.versionOption(e.version, e.prerelease, e.date))));
      const notesLink = h("a", { target: "_blank", rel: "noopener" }, S.form.notes);
      cfgNote = note(S.addsSettings, "note--info");
      const syncVersion = () => {
        const entry = app.releases.find((e) => e.version === f.version) || app.releases[0];
        if (entry && entry.notes) { notesLink.href = entry.notes; notesLink.hidden = false; } else notesLink.hidden = true;
        cfgNote.hidden = !addsSettings(entry, app.info);
      };
      select.addEventListener("change", () => { f.version = select.value; syncVersion(); });
      form.append(section(S.form.sections.firmware,
        h("div", { class: "field" }, h("div", { class: "field__head" }, h("label", { for: id }, S.form.version)),
          h("div", { class: "input-row" }, select, notesLink)),
        note(flow.erase ? S.form.eraseNote : S.form.keepNote), cfgNote));
      syncVersion();
    }

    // The buttons.
    // Always in the page and only refilled when the errors change: an alert
    // that is merely un-hidden isn't announced by every screen reader, and one
    // refilled on every keystroke would be announced over and over.
    const summary = h("div", { class: "form-summary", role: "alert" });
    let summaryShown = "";
    // Already flashed: there is no going back from these two.
    const backTo = f.flow === "review" || f.flow === "setup" ? null : (app.info ? showHome : showPathB);
    // Enter never saves, flashes or restarts (Eric, 2026-10-12). Only the
    // action button does, clicked or keyboard-activated. So the form has no
    // submit button: Enter in a field then submits nothing (and with a single
    // field, only fires "submit", which saves nothing). A submitter check
    // wouldn't do: implicit submission reports the default button as the
    // submitter. Pinned by a test: no type "submit" anywhere in web/js.
    form.append(h("div", { class: "form-foot" }, summary,
      h("div", { class: "actions" },
        btn(S.form.submit[f.flow], submit, { class: "btn btn--primary btn--big" }),
        backTo ? btn(S.form.back, backTo, { kind: "link" }) : null)));
    form.addEventListener("submit", (e) => e.preventDefault());
    refreshers.push(() => {
      // Errors with no field of their own (a SET error on "wifi", say) are listed here.
      const orphans = Object.entries(currentErrors).filter(([k]) => !slots.has(k)).map(([, msg]) => msg);
      const show = f.submitted && Object.keys(currentErrors).length > 0;
      const now = show ? JSON.stringify(orphans) : "";
      if (now === summaryShown) return;
      summaryShown = now;
      const parts = show ? [h("p", {}, S.form.summary)] : [];
      if (show && orphans.length) parts.push(h("ul", {}, orphans.map((o) => h("li", {}, o))));
      summary.replaceChildren(...parts);
    });

    function submit() {
      f.submitted = true;
      refresh();
      if (Object.keys(currentErrors).length) {
        say(currentErrors.location ? S.form.needLocation : S.form.invalid, "error");
        const first = [...form.querySelectorAll('[aria-invalid="true"]')][0];
        if (first) first.focus();
        return;
      }
      closeTip();
      if (flow.flash) runFlash();
      else saveSettings();
    }

    refresh();
    if (focus === "wifi") (f.wifi.choice === "new" ? ssid.input : configure.input).focus();
  });

  function refresh() {
    if (!alive) return;
    const errs = formErrors(f, app.zones);
    for (const [k, raw] of Object.entries(f.serverErrors)) errs[k] = fieldMessage(k, raw);
    currentErrors = errs;
    for (const [key, slot] of slots) {
      const msg = errs[key];
      const shown = !!msg && (f.submitted || f.touched.has(key) || Object.hasOwn(f.serverErrors, key));
      slot.error.hidden = !shown;
      slot.error.textContent = shown ? msg : "";
      for (const i of slot.inputs) i.setAttribute("aria-invalid", shown ? "true" : "false");
    }
    for (const [key, el] of badgeSlots) {
      el.replaceChildren(...badgesFor(key, f).map((b) =>
        h("span", { class: `badge badge--${b}` }, b === "new" ? S.form.badgeNew : S.form.badgeImported)));
    }
    for (const fn of refreshers) fn();
    if (preview) preview.update(f.config, app.live);
  }

  // Imports re-draw the form with the new values and say what happened.
  async function importConfigH(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    let res;
    try {
      res = parseConfigH(await file.text(), app.zones || {});
      if (!alive) return;
    } catch (e) {
      report(e);
      return showForm({ say: S.form.badFile, tone: "error" });
    }
    f.config = mergeConfig(f.config, res.config);
    markImported(Object.keys(res.config));
    const label = (k) => S.keyLabels[k] || k;
    const lines = [S.form.configImported(res.imported.length)];
    if (res.defaulted.length) lines.push(S.form.defaulted(escapeRich(res.defaulted.map(label).join(", "))));
    if (res.skipped.length) lines.push(S.form.skipped(escapeRich(res.skipped.join(", "))));
    showForm({ say: lines.join(" ") });
  }

  async function importBackup(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    let cfg;
    try {
      cfg = readBackup(JSON.parse(await file.text()));
      if (!alive) return;
    } catch (e) {
      report(e);
      return showForm({ say: e instanceof BadBackup ? S.form.badBackup : S.form.badFile, tone: "error" });
    }
    f.config = mergeConfig(f.config, cfg);
    markImported(Object.keys(cfg));
    showForm({ say: S.form.backupImported(Object.keys(cfg).length) });
  }

  function markImported(keys) {
    f.imported = [...new Set([...f.imported, ...keys])];
    const place = LOCATION_KEYS.filter((k) => keys.includes(k));
    if (place.length) { gave(...place); f.placeLabel = ""; } // imported: coordinates only
    for (const k of keys) {
      if (k === "pages") PAGE_KEYS.forEach((p) => touch(`pages.${p}`));
      touch(k);
    }
  }
}

// ── Saving settings ───────────────────────────────────────

async function saveSettings() {
  const f = app.form;
  const req = formToRequest(f);
  let g;
  screen(S.titles.saving, (m) => {
    g = guide(m, { mood: "curious", say: S.saving.say });
    m.append(spinner(), logPanel());
  });
  app.expectDrop = true;
  let res;
  try {
    res = await change(app.bp, "SET", req, { waitRestart: true });
  } catch (e) {
    // The Buddy took the settings but hasn't come back (reconnect gave up).
    report(e);
    app.expectDrop = false;
    return showProblem(S.flash.noComeBack, null, { retry: () => finishSave(req, { redraw: true }) });
  }
  if (!res.ok) {
    app.expectDrop = false;
    if (res.reply && res.reply.errors) {
      f.serverErrors = res.reply.errors;
      f.submitted = true;
      return showForm({ say: S.form.setErrors, tone: "error" });
    }
    log(res.note || (res.reply && res.reply.error) || "SET failed", "* ");
    return showProblem(S.saving.failed, null, { retry: () => showForm(), retryLabel: S.form.back });
  }
  if (res.note) log(res.note, "* ");
  if (req.wifi) { g.say(S.saving.joining(escapeRich(req.wifi.ssid))); g.mood("excited"); }
  await finishSave(req);
}

// After the restart: poll INFO for up to 30 s, then show the result. The 30 s
// count from when the Buddy is back (change() returns after the restart), so
// joining the Wi-Fi gets the whole window. One at a time: a retry button
// pressed twice must not start two reconnect loops on the same port.
let finishing = false;
async function finishSave(req, { redraw = false } = {}) {
  if (finishing) return;
  finishing = true;
  try {
    if (redraw) {
      screen(S.titles.saving, (m) => {
        guide(m, { mood: "curious", say: req.wifi ? S.saving.joining(escapeRich(req.wifi.ssid)) : S.saving.waiting });
        m.append(spinner(), logPanel());
      });
    }
    app.expectDrop = true;
    let info = await infoOnce();
    if (!info) {
      try { info = await app.bp.reconnect(30000); } catch (e) { report(e); }
    }
    const t0 = Date.now();
    if (req.wifi) {
      while (!joinedWifi(info, req.wifi.ssid) && Date.now() - t0 < WIFI_WAIT_MS) {
        await sleep(2000);
        info = (await infoOnce()) || info;
      }
    }
    app.expectDrop = false;
    if (!info) return showProblem(S.flash.noComeBack, null, { retry: () => finishSave(req, { redraw: true }) });
    app.info = info;
    const installed = app.form.installed;
    app.form.installed = null;
    const w = info.wifi || {};
    showResult(resultKind(req, info), { ssid: req.wifi ? req.wifi.ssid : w.ssid, installed });
  } finally {
    finishing = false;
  }
}

// ── Flashing ──────────────────────────────────────────────

// Where each stage starts on the progress bar, in percent.
function stagePlan(erase) {
  const order = ["download", "check", "connect", ...(erase ? ["erase"] : []), "write", "restart"];
  const at = erase
    ? { download: 0, check: 12, connect: 15, erase: 22, write: 40, restart: 95 }
    : { download: 0, check: 15, connect: 18, write: 26, restart: 95 };
  return { order, at };
}

function showFlashing(entry, erase) {
  const { order, at } = stagePlan(erase);
  let g, bar;
  const items = {};
  let current = null;
  screen(S.titles.flashing, (m) => {
    g = guide(m, { mood: "excited", say: S.flash.say.download });
    bar = h("progress", { class: "progress", max: "100", value: "0", "aria-label": S.flash.progress });
    g.below.append(bar);
    m.append(h("div", { class: "flash" },
      h("p", { class: "flash__version" }, S.flash.version(entry.version)),
      h("ol", { class: "stages" }, order.map((s) => { items[s] = h("li", { class: "stage", "data-state": "todo" }, S.flash.stages[s]); return items[s]; }))),
    logPanel());
  });
  return {
    stage(s) {
      if (!items[s]) return;
      current = s;
      let done = true;
      for (const name of order) {
        if (name === s) { done = false; items[name].dataset.state = "now"; items[name].setAttribute("aria-current", "step"); continue; }
        items[name].dataset.state = done ? "done" : "todo";
        items[name].removeAttribute("aria-current");
      }
      if (s === "erase") bar.removeAttribute("value"); // no progress from eraseFlash: indeterminate
      else bar.value = at[s];
      g.say(S.flash.say[s]);
    },
    progress(x) {
      if (current !== "write") return;
      bar.value = Math.round(at.write + x * (at.restart - at.write));
    },
    say(text) { g.add(text); },
    done() {
      for (const name of order) { items[name].dataset.state = "done"; items[name].removeAttribute("aria-current"); }
      bar.value = 100;
    },
  };
}

async function runFlash() {
  const f = app.form;
  const flow = FLOWS[f.flow];
  const entry = app.releases.find((e) => e.version === f.version) || app.releases[0];
  const ui = showFlashing(entry, flow.erase);
  leaveGuard(true);
  let image;
  try {
    ui.stage("download");
    image = await fetchImage(entry, SITE_ROOT, { onStage: (s) => ui.stage(s) });
    log(`image ok: ${image.length} bytes, SHA-256 matches the release list`, "* ");
  } catch (e) {
    leaveGuard(false);
    report(e);
    return showProblem(e instanceof ImageMismatch ? S.flash.checksum : S.flash.downloadFailed, null,
      { retry: runFlash, back: () => (f.flow === "recover" ? showPathB() : showForm()) }); // recover has no form
  }
  await writeImage(entry, image, ui);
}

async function writeImage(entry, image, ui) {
  const flow = FLOWS[app.form.flow];
  if (!ui) { ui = showFlashing(entry, flow.erase); ui.stage("check"); }
  leaveGuard(true);
  app.expectDrop = true;
  // esptool-js opens the port itself, so the protocol session closes first.
  try { await app.bp.close(); } catch { /* already closed */ }
  // After a USB drop (a reset, BOOT/RESET, a cut-off flash) the old port
  // handle never opens again, so every retry flashes the port as it is now.
  const port = await app.bp.refind();
  let resetFailed = false;
  try {
    await dev.flashImage(port, image, {
      erase: flow.erase,
      expectedMac: app.bp.mac, // known on path A: never flash another Buddy
      onStage: (s) => ui.stage(s === "reset" ? "restart" : s),
      onProgress: (x) => ui.progress(x),
      log: (t) => log(String(t).replace(/\s+$/, ""), "[esptool] "),
    });
  } catch (e) {
    report(e);
    if (e instanceof FlashError && e.stage === "reset") {
      resetFailed = true; // written; only the restart didn't happen
    } else {
      leaveGuard(false);
      app.expectDrop = false;
      // esptool couldn't reach the chip. On the Buddy that is always the port,
      // never the install-mode switch: the C6's built-in USB does that in silicon,
      // and manual BOOT/RESET takes the board off USB altogether (measured
      // 2026-10-12). A stale handle refind() missed, or stuck bytes Chrome won't
      // let go of: a replug fixes both.
      if (e instanceof FlashError && e.cause instanceof WrongBoard) {
        return showProblem(S.flash.wrongBoard, null, { retry: () => writeImage(entry, image) });
      }
      if (e instanceof FlashError && e.stage === "connect") return showProblem(S.flash.replug, null, { retry: () => writeImage(entry, image) });
      const text = e instanceof FlashError && e.stage === "erase" ? S.flash.eraseFailed : S.flash.writeFailed;
      return showProblem(text, null, { retry: () => writeImage(entry, image) });
    }
  }
  ui.stage("restart");
  if (resetFailed) ui.say(S.flash.resetHint);
  await afterFlash(entry, ui);
}

// The board restarts into the new firmware: reconnect, GET, merge the form
// over the new defaults, then SET (or show the form first if keys were added).
async function afterFlash(entry, ui) {
  if (!ui) { ui = showFlashing(entry, FLOWS[app.form.flow].erase); ui.stage("restart"); }
  leaveGuard(true);
  app.expectDrop = true;
  let info;
  try {
    info = await app.bp.reconnect(30000);
  } catch (e) {
    report(e);
    leaveGuard(false);
    app.expectDrop = false;
    return showProblem(S.flash.noComeBack, null, { retry: () => afterFlash(entry) });
  }
  leaveGuard(false);
  app.info = info;
  ui.done();
  let got;
  try {
    got = await app.bp.command("GET");
    if (!got || !got.ok || !got.config) throw new Error(got && got.error ? got.error : "GET failed");
  } catch (e) {
    report(e);
    app.expectDrop = false;
    return showProblem(S.connecting.readFailed, null, { retry: () => afterFlash(entry) });
  }
  if (app.form.flow === "recover") {
    app.expectDrop = false;
    if (afterRecovery(got) === "keep") {
      // What the Buddy saved survived the cut-off install: nothing to write,
      // unless this firmware brings settings the saved ones predate. Those get
      // the same review as after an update.
      const added = got.added || [];
      app.form = newFormState(fromBoard(got.config), { flow: added.length ? "review" : "change", info, added });
      app.form.installed = info.fw;
      if (added.length) return showForm({ say: S.form.say.review });
      app.form.installed = null;
      return showResult("saved", { installed: info.fw });
    }
    app.form = newFormState(fromBoard(got.config), { flow: "setup", info, added: got.added || [] });
    app.form.installed = info.fw;
    return showForm({ say: S.form.say.setup });
  }
  const f = app.form;
  f.config = mergeConfig(fromBoard(got.config), f.config);
  f.installed = info.fw;
  app.expectDrop = false;
  if (got.added && got.added.length) {
    f.added = got.added;
    f.flow = "review";
    return showForm({ say: S.form.say.review });
  }
  f.flow = "change"; // from here on, a retry is a settings change
  await saveSettings();
}

// ── Results and problems ──────────────────────────────────

function showResult(kind, { ssid = "", installed = null } = {}) {
  screen(kind === "wifiFailed" ? S.titles.wifiFailed : S.titles.result, (m) => {
    const done = btn(S.result.done, () => busy(backHome), { kind: "primary" });
    if (kind === "connected") {
      const g = guide(m, { mood: "love", say: S.result.connected(escapeRich(ssid)) });
      if (installed) g.add(S.result.installed(escapeRich(installed)));
      m.append(actions(done, btn(S.result.change, () => busy(startChange), { kind: "link" })));
      confetti();
    } else if (kind === "wifiFailed") {
      const g = guide(m, { mood: "sad", say: installed ? S.result.installed(escapeRich(installed)) : S.result.wifiFailed(escapeRich(ssid)) });
      if (installed) g.add(S.result.wifiFailed(escapeRich(ssid)), "error");
      m.append(actions(
        btn(S.problem.retry, () => { app.form.flow = "change"; app.form.added = []; showForm({ focus: "wifi" }); }, { kind: "primary" }),
        btn(S.result.done, () => busy(backHome), { kind: "link" })));
    } else if (kind === "hotspot") {
      const g = guide(m, { mood: "happy", say: installed ? S.result.installed(escapeRich(installed)) : S.result.hotspot });
      if (installed) g.add(S.result.hotspot);
      m.append(h("ol", { class: "card steps" }, S.result.hotspotSteps.map((s) => h("li", {}, rich(s)))), actions(done));
    } else if (kind === "reset") {
      guide(m, { mood: "happy", say: S.result.reset });
      m.append(actions(done));
    } else {
      guide(m, { mood: "happy", say: installed ? S.result.installed(escapeRich(installed)) : S.result.saved });
      m.append(actions(done, btn(S.result.change, () => busy(startChange), { kind: "link" })));
    }
  });
}

function showProblem(text, err, { retry, retryLabel, back } = {}) {
  report(err);
  leaveGuard(false);
  screen(S.titles.problem, (m) => {
    guide(m, { mood: "sad", say: text });
    m.append(actions(
      retry ? btn(retryLabel || S.problem.retry, retry, { kind: "primary" }) : null,
      back ? btn(S.form.back, back) : null,
      btn(S.problem.startOver, startOver, { kind: "link" })),
    logPanel());
  });
}

// ── Confetti, for a Buddy that made it onto the Wi-Fi ─────

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#5dcaa5", "#ffd25a", "#ff7896", "#00c8ff", "#ffb428", "#ffffff"];
  const layer = h("div", { class: "confetti", "aria-hidden": "true" });
  for (let i = 0; i < 90; i++) {
    const piece = h("i");
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 30}vw`);
    piece.style.setProperty("--spin", `${(Math.random() * 3 + 1) * (Math.random() < 0.5 ? -1 : 1)}turn`);
    piece.style.setProperty("--delay", `${Math.random() * 0.8}s`);
    piece.style.setProperty("--time", `${2.4 + Math.random() * 1.6}s`);
    piece.style.background = colors[i % colors.length];
    layer.append(piece);
  }
  document.body.append(layer);
  const remove = () => layer.remove();
  setTimeout(remove, 5000);
  cleanups.push(remove);
}

// ── The page around the screens ───────────────────────────

function chrome() {
  document.title = S.title;
  if (params.has("fake")) {
    // A shared ?fake link must never pass for a real install.
    const banner = h("div", { class: "fake-banner", role: "note" }, S.fake);
    document.body.prepend(banner);
    // Sticky things below it (the preview) start under it.
    const measure = () => document.documentElement.style.setProperty("--banner-h", `${banner.offsetHeight}px`);
    new ResizeObserver(measure).observe(banner);
    window.addEventListener("resize", measure);
    measure();
  }
  document.getElementById("skip").textContent = S.skipLink;
  document.getElementById("app-name").textContent = S.appName;
  document.getElementById("app-tagline").textContent = S.appTagline;
  const beta = document.getElementById("beta");
  beta.textContent = S.beta;
  beta.hidden = !BETA;
  const about = document.getElementById("about");
  about.replaceChildren(
    h("h2", {}, S.about.heading),
    h("p", {}, S.about.body),
    h("p", {}, S.about.privacy),
    h("ul", { class: "links" },
      h("li", {}, h("a", { href: S.about.projectUrl, target: "_blank", rel: "noopener" }, S.about.project)),
      h("li", {}, h("a", { href: S.about.guideUrl, target: "_blank", rel: "noopener" }, S.about.guide)),
      h("li", {}, h("a", { href: S.about.issueUrl, target: "_blank", rel: "noopener" }, S.about.issue))),
    h("p", { class: "about__credit" }, `${S.about.copyright} `,
      h("a", { href: S.about.authorUrl, target: "_blank", rel: "noopener" }, S.about.author), " · ",
      h("a", { href: S.about.licenceUrl, target: "_blank", rel: "noopener" }, S.about.licence)));
}

async function loadManifest() {
  try {
    const r = await fetch("firmware/releases.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    app.manifest = parseManifest(await r.json());
    app.releases = offered(app.manifest, BETA);
  } catch (e) {
    app.manifestError = true;
    report(e);
  }
}

async function loadZones() {
  try {
    const r = await fetch("vendor/posix_tz_db/zones.json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    app.zones = await r.json();
  } catch (e) {
    report(e);
  }
}

chrome();
await Promise.all([loadManifest(), loadZones()]);
showStart();
