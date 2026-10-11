// The settings form's logic: the request it sends, its badges, its Wi-Fi
// choices, its errors and its help texts. Pure: no DOM, no Web Serial, so the
// tests run it (web-tests/form.test.mjs). app.js draws the form.
import { S } from "./strings.js";
import { validateConfig, validateWifi } from "./settings.js";
import { ruleForZone } from "./tz.js";

// The firmware's built-in values: config/config.h.example, which the release
// builds use, with the template's placeholder Finnhub key as empty (the stock
// page stays hidden) and tz_rule from the zone table. The form starts here
// when there is no board to ask (path B). KEEP IN SYNC with config.h.example;
// form.test.mjs compares the two.
export const DEFAULTS = Object.freeze({
  mount: "left",
  theme: 2,
  github_user: "IdefixRC",
  tz_name: "Asia/Singapore",
  tz_rule: "<+08>-8",
  ticker: "AAPL",
  stock_key: "",
  lat: "1.3119",
  lon: "103.8149",
  temp_unit: "celsius",
  wind_unit: "kmh",
  pages: Object.freeze({ face: true, clock: true, date: true, weather: true, moon: true, stock: true, github: true }),
});

// Flows, as spec §4. flash: the flow writes firmware; erase: it erases first.
export const FLOWS = Object.freeze({
  change: { flash: false, erase: false },  // path A: settings only
  review: { flash: false, erase: false },  // after a flash that added keys
  update: { flash: true, erase: false },   // path A
  fresh: { flash: true, erase: true },     // path A
  upgrade: { flash: true, erase: false },  // path B, from 1.1 or older
  install: { flash: true, erase: true },   // path B, a new board
});

const PLACEHOLDER_KEY = "xxxxxxx"; // config.h.example's STOCKKEY

// A board's GET config as the form shows it. A release build without a saved
// key reports the template's placeholder, which is no key at all.
export function fromBoard(config) {
  const out = structuredClone(config || {});
  if (out.stock_key === PLACEHOLDER_KEY) out.stock_key = "";
  return out;
}

// The Wi-Fi choices for a flow (spec §4). "keep" only when the board reports
// saved Wi-Fi and the flow doesn't erase it, or on path B for upgrades, where
// there is no INFO to ask. The first choice is the default.
// -> [{ value: "keep" | "new", label }]
export function wifiChoices(info, path) {
  const flow = FLOWS[path] || FLOWS.change;
  const wifi = info && info.wifi;
  const choices = [];
  if (!flow.erase && wifi && wifi.saved) {
    choices.push({ value: "keep", label: S.form.wifiKeep(wifi.ssid || "") });
  } else if (!info && path === "upgrade") {
    choices.push({ value: "keep", label: S.form.wifiKeepUnknown });
  }
  choices.push({ value: "new", label: S.form.wifiNew });
  return choices;
}

// A fresh form: the given config, Wi-Fi on with the default choice.
// location: the location keys ("lat", "lon", "tz_name") the user has given
// (picked, typed, imported); see locationMissing.
export function newFormState(config, { flow, info = null, added = [], imported = [], location = [] } = {}) {
  return {
    flow,
    config: structuredClone(config),
    wifi: { configure: true, choice: wifiChoices(info, flow)[0].value, ssid: "", password: "" },
    added: [...added],
    imported: [...imported],
    location: [...location],
  };
}

// The keys that make up the location.
export const LOCATION_KEYS = Object.freeze(["lat", "lon", "tz_name"]);

// A fresh install (one that erases) must never write the firmware's built-in
// location without the user choosing it (Eric, 2026-10-11): the place has to
// come from the city search, from typing all three values, or from an import.
// Upgrades and settings changes keep the board's location.
export function locationMissing(state) {
  const flow = FLOWS[state.flow];
  if (!flow || !flow.erase) return false;
  const given = state.location || [];
  return !LOCATION_KEYS.every((k) => given.includes(k));
}

// The location keys a board's saved settings count as given for a fresh
// install that starts from them: only when the board has saved settings
// (stored) and its place isn't the built-in one.
export function boardLocation(got) {
  if (!got || got.stored !== true || !got.config) return [];
  const c = got.config;
  const builtIn = LOCATION_KEYS.every((k) => String(c[k]) === String(DEFAULTS[k]));
  return builtIn ? [] : [...LOCATION_KEYS];
}

// -> { config, wifi? }, the body of SET. wifi is left out when "Configure
// Wi-Fi" is off or "Keep the current Wi-Fi" is chosen, so the board's saved
// network stays as it is.
export function formToRequest(state) {
  const req = { config: structuredClone(state.config) };
  const w = state.wifi;
  if (w && w.configure && w.choice === "new") req.wifi = { ssid: w.ssid, password: w.password };
  return req;
}

// "pages.moon" (the firmware's path for one page) also matches "pages" (an
// imported pages object), and "pages" matches any single page.
function listed(list, key) {
  if (!list) return false;
  return [...list].some((k) => k === key
    || (key.startsWith("pages.") && k === "pages")
    || (key === "pages" && k.startsWith("pages.")));
}

// -> ("new" | "imported")[]
export function badgesFor(key, { added = [], imported = [] } = {}) {
  const out = [];
  if (listed(added, key)) out.push("new");
  if (listed(imported, key)) out.push("imported");
  return out;
}

// The help text for a setting. Throws for an unknown key, so a setting
// without a text fails the tests instead of showing an empty bubble.
export function helpFor(key) {
  if (!Object.hasOwn(S.help, key) || typeof S.help[key] !== "string" || !S.help[key].trim()) {
    throw new Error(`no help text for "${key}"`);
  }
  return S.help[key];
}

// The text shown for an error under `key` ("theme", "pages.clock",
// "wifi.ssid"), whether it came from validateConfig or from the Buddy's SET.
export function fieldMessage(key, raw) {
  if (key.startsWith("pages.")) return S.errors.page;
  if (Object.hasOwn(S.errors, key)) return S.errors[key];
  const text = String(raw || S.problem.generic);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Every error in the form, keyed like the firmware's: { key: message }.
// zones: the time zone table; a zone that isn't in it is an error, since the
// clock rule comes from it.
export function formErrors(state, zones) {
  const out = {};
  const { errors } = validateConfig(state.config);
  for (const [key, raw] of Object.entries(errors)) out[key] = fieldMessage(key, raw);
  if (!out.tz_name && zones && ruleForZone(zones, state.config.tz_name) === null) {
    out.tz_name = S.errors.tzUnknown;
  }
  if (locationMissing(state)) out.location = S.errors.location;
  const w = state.wifi;
  if (w && w.configure && w.choice === "new") {
    for (const [key, raw] of Object.entries(validateWifi({ ssid: w.ssid, password: w.password }).errors)) {
      out[key] = fieldMessage(key, raw);
    }
  }
  return out;
}

// Serial lines and requests for the details log: the Finnhub key and the
// Wi-Fi password never appear in it.
export function redactLog(text) {
  return String(text)
    .replace(/("stock_key"\s*:\s*)"(?:[^"\\]|\\.)+"/g, '$1"<redacted>"')
    .replace(/("password"\s*:\s*)"(?:[^"\\]|\\.)+"/g, '$1"<redacted>"');
}

const money = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// checkStock's result as a sentence.
export function stockMessage(res, ticker = "") {
  if (res.status === "ok") return S.check.stock.ok(ticker, money(res.price));
  return S.check.stock[res.status] || S.check.stock.network;
}

// checkGithub's result as a sentence.
export function githubMessage(res) {
  if (res.status === "ok") return S.check.github.ok(res.followers, res.repos);
  return S.check.github[res.status] || S.check.github.network;
}

// How long the result screen waits for the Buddy to join the Wi-Fi, counted
// from when it answers again after the restart.
export const WIFI_WAIT_MS = 30000;

// INFO shows the Buddy on the network the request asked for.
export function joinedWifi(info, ssid) {
  return !!(info && info.wifi && info.wifi.connected && info.wifi.ssid === ssid);
}

// The result screen after a SET (spec §4): "connected" or "wifiFailed" when
// Wi-Fi was sent; "hotspot" when none was sent and none is saved; else "saved".
export function resultKind(req, info) {
  const w = (info && info.wifi) || {};
  if (req && req.wifi) return joinedWifi(info, req.wifi.ssid) ? "connected" : "wifiFailed";
  if (!w.saved) return "hotspot";
  return "saved";
}

// True when the release's settings format is newer than the board's, so the
// update brings settings this form can't show yet.
export function addsSettings(entry, info) {
  if (!entry || !info) return false;
  const a = Number(entry.cfg_v), b = Number(info.cfg_v);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

// ── The light markup of strings.js ────────────────────────
// **bold**, `code` and [text](https://link). A backslash makes the next
// character literal, so escapeRich() turns any text (an SSID, a firmware
// version, a file's contents) into plain text inside a marked-up string.

export function escapeRich(text) {
  return String(text).replace(/[\\*`[\]]/g, (c) => `\\${c}`);
}

// -> [{ type: "text" | "strong" | "code" | "link", text, href? }]
export function parseRich(text) {
  const s = String(text);
  const out = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ type: "text", text: buf }); buf = ""; } };
  // The text up to `delim` (escapes resolved) and the index after it, or null.
  const until = (i, delim) => {
    let v = "";
    while (i < s.length) {
      if (s[i] === "\\" && i + 1 < s.length) { v += s[i + 1]; i += 2; continue; }
      if (s.startsWith(delim, i)) return [v, i + delim.length];
      v += s[i++];
    }
    return null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
    if (s.startsWith("**", i)) {
      const r = until(i + 2, "**");
      if (r && r[0]) { flush(); out.push({ type: "strong", text: r[0] }); i = r[1]; continue; }
    } else if (c === "`") {
      const r = until(i + 1, "`");
      if (r && r[0]) { flush(); out.push({ type: "code", text: r[0] }); i = r[1]; continue; }
    } else if (c === "[") {
      const r = until(i + 1, "]");
      const m = r && /^\((https:\/\/[^)\s]+)\)/.exec(s.slice(r[1]));
      if (m && r[0]) { flush(); out.push({ type: "link", text: r[0], href: m[1] }); i = r[1] + m[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}
