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
export function newFormState(config, { flow, info = null, added = [], imported = [] } = {}) {
  return {
    flow,
    config: structuredClone(config),
    wifi: { configure: true, choice: wifiChoices(info, flow)[0].value, ssid: "", password: "" },
    added: [...added],
    imported: [...imported],
  };
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

// True when the release's settings format is newer than the board's, so the
// update brings settings this form can't show yet.
export function addsSettings(entry, info) {
  if (!entry || !info) return false;
  const a = Number(entry.cfg_v), b = Number(info.cfg_v);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}
