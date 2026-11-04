// The settings form's logic: the request it sends, its badges, its Wi-Fi
// choices, its errors and its help texts. Pure: no DOM, no Web Serial, so the
// tests run it (web-tests/form.test.mjs). app.js draws the form.
import { S } from "./strings.js";
import { validateConfig, validateWifi, BASELINE_PATHS, filterSupported, mergeConfig, newlyOffered, withStocks } from "./settings.js";
import { ruleForZone } from "./tz.js";
import { pageList } from "./preview.js";

// The firmware's built-in values: config/config.h.example, which the release
// builds use (an empty GitHub user and Finnhub key hide those pages), with
// tz_rule from the zone table. The form starts here
// when there is no board to ask (path B). KEEP IN SYNC with config.h.example;
// form.test.mjs compares the two.
export const DEFAULTS = Object.freeze({
  mount: "left",
  theme: 2,
  brightness: 180,
  github_user: "",
  tz_name: "Asia/Singapore",
  tz_rule: "<+08>-8",
  ticker: "AAPL",
  stocks: Object.freeze([Object.freeze({ symbol: "AAPL", on: true })]),
  stock_key: "",
  coins: Object.freeze([Object.freeze({ pair: "BTC-USD", source: "coinbase", on: true })]),
  lat: "1.3119",
  lon: "103.8149",
  clock_format: "24h",
  temp_unit: "celsius",
  wind_unit: "kmh",
  night: Object.freeze({ enabled: false, start: 23, end: 7, brightness: 26 }),
  pages: Object.freeze({ face: true, clock: true, date: true, weather: true, moon: true, stock: true, github: true, coin: true }),
});

// Flows, as spec §4. flash: the flow writes firmware; erase: it erases first.
export const FLOWS = Object.freeze({
  change: { flash: false, erase: false },  // path A: settings only
  review: { flash: false, erase: false },  // after a flash that added keys
  update: { flash: true, erase: false },   // path A
  fresh: { flash: true, erase: true },     // path A
  upgrade: { flash: true, erase: false },  // path B, from 1.1 or older
  install: { flash: true, erase: true },   // path B, a new board
  recover: { flash: true, erase: false },  // path B, a Buddy that can't start: no form
  setup: { flash: false, erase: false },   // after a recovery that found nothing saved
});

// After a recovery flash (a Buddy whose install was cut off), what GET found
// decides (hardware test, 2026-10-12): settings it saved before survived on
// LittleFS, so "keep" them as they are; with none, "setup" asks for them.
// The recovery form used to start from defaults and overwrite them.
export function afterRecovery(got) {
  return got && got.stored === true ? "keep" : "setup";
}

const PLACEHOLDER_KEY = "xxxxxxx"; // STOCKKEY in config.h.example before 1.2

// Set the ticker and keep the first stock in step (the board stores them as one).
export function setTicker(config, symbol) {
  config.ticker = symbol;
  if (Array.isArray(config.stocks) && config.stocks[0]) {
    config.stocks = [{ ...config.stocks[0], symbol }, ...config.stocks.slice(1)];
  }
}

// A board's GET config as the form shows it. A board running an older release
// build without a saved key reports the old template's placeholder, which is no
// key at all. A 1.2 board's ticker seeds the first stock.
export function fromBoard(config) {
  const out = withStocks(config || {});
  if (out.stock_key === PLACEHOLDER_KEY) out.stock_key = "";
  // A 1.2 board has no coins and no coin page; 1.3 starts with BTC-USD and the
  // page on (what the board itself does after the flash). filterSupported
  // strips both again for a target without them.
  if (!Object.hasOwn(out, "coins")) out.coins = structuredClone(DEFAULTS.coins);
  if (!out.pages || !Object.hasOwn(out.pages, "coin")) out.pages = { ...out.pages, coin: DEFAULTS.pages.coin };
  // Likewise the clock format and night mode (both off) that 1.3 added.
  if (!Object.hasOwn(out, "clock_format")) out.clock_format = DEFAULTS.clock_format;
  if (!Object.hasOwn(out, "night")) out.night = { ...DEFAULTS.night };
  // And the brightness, which a 1.2 board keeps in /display.json without showing it.
  if (!Object.hasOwn(out, "brightness")) out.brightness = DEFAULTS.brightness;
  return out;
}

// A board's GET config as a backup keeps it. fromBoard seeds the brightness of
// a board too old to report one; a backup must not carry that made-up value.
export function backupConfig(boardConfig) {
  const out = fromBoard(boardConfig);
  if (!boardConfig || !Object.hasOwn(boardConfig, "brightness")) delete out.brightness;
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
export function newFormState(config, { flow, info = null, added = [], imported = [], location = [], supported = BASELINE_PATHS, teaser = [] } = {}) {
  const state = {
    flow,
    config: structuredClone(config),
    wifi: { configure: true, choice: wifiChoices(info, flow)[0].value, ssid: "", password: "" },
    added: [...added],
    imported: [...imported],
    location: [...location],
    supported: new Set(supported),
    teaser: new Set(teaser || []),
  };
  state.stockSlots = stockSlots(state.config.stocks);
  state.stockSlotOf = slotsToStocks(state.stockSlots).slotOf;
  state.coinSlots = coinSlots(state.config.coins); // empty slots start on Coinbase
  state.coinSlotOf = slotsToCoins(state.coinSlots).slotOf;
  return state;
}

// What the preview draws: only what the target firmware has, so a target
// without coins shows no Coin page.
export const previewConfig = (state) => filterSupported(state.config, state.supported);

// The form shows a setting only if the Buddy it will be sent to understands
// it (spec §5.3): the running board's GET for Change settings; the firmware
// picked at the bottom for flash flows; 1.2.0's set when neither is known.
// Every field added after 1.2.0 must be drawn only when this is true.
export const offered = (state, path) => !!(state && state.supported && state.supported.has(path));

// The keys that make up the location.
export const LOCATION_KEYS = Object.freeze(["lat", "lon", "tz_name"]);

// A fresh install (one that erases) must never write the firmware's built-in
// location without the user choosing it (Eric, 2026-10-11): the place has to
// come from the city search, from typing all three values, or from an import.
// A path B upgrade counts as one too: after 1.1 -> 1.2 the board's defaults are
// the release build's, so skipping the config.h import would silently write
// the built-in place. So does the setup after a recovery that found nothing
// saved. Path A updates and settings changes keep the board's location.
export function locationMissing(state) {
  const flow = FLOWS[state.flow];
  if (!flow || !(flow.erase || state.flow === "upgrade" || state.flow === "setup")) return false;
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
  const req = { config: state.supported ? filterSupported(state.config, state.supported) : structuredClone(state.config) };
  const w = state.wifi;
  if (w && w.configure && w.choice === "new") req.wifi = { ssid: w.ssid, password: w.password };
  // The board stores ticker as the first stock; send them in step (spec §3.1).
  const st = req.config.stocks;
  if (Array.isArray(st) && st[0] && typeof st[0].symbol === "string") req.config.ticker = st[0].symbol;
  return req;
}

// ── Slots (spec stocks-and-coins §6.1) ────────────────────
// Five slots in the form; the board stores the filled ones in slot order,
// switched-off ones included (on: false). Slot 1 is always on. Stocks and
// coins share these two helpers.
export const STOCK_SLOTS = 5;
export const COIN_SLOTS = 5;

// `count` slots from a stored list: entry i fills slot i when isFilled says it
// is a real entry (fill(entry, i) builds the slot), else the slot is blank(i).
function slotsFrom(list, blank, isFilled, fill, count) {
  const src = Array.isArray(list) ? list : [];
  return Array.from({ length: count }, (_, i) => {
    const e = src[i];
    return e && isFilled(e) ? fill(e, i) : blank(i);
  });
}

// The stored list of the filled slots, in slot order, and which form slot
// each one came from. pick(slot, i) builds the stored entry.
function slotsToList(slots, isFilled, pick) {
  const list = [];
  const slotOf = [];
  slots.forEach((s, i) => {
    if (!isFilled(s)) return;
    list.push(pick(s, i));
    slotOf.push(i);
  });
  return { list, slotOf };
}

export function stockSlots(stocks) {
  return slotsFrom(stocks, (i) => ({ symbol: "", on: i === 0 }),
    (e) => typeof e.symbol === "string",
    (e, i) => ({ symbol: e.symbol, on: i === 0 ? true : e.on !== false }), STOCK_SLOTS);
}

export function slotsToStocks(slots) {
  const { list, slotOf } = slotsToList(slots, (s) => !!s.symbol,
    (s, i) => ({ symbol: s.symbol, on: i === 0 ? true : !!s.on }));
  return { stocks: list, slotOf };
}

export function coinSlots(coins) {
  return slotsFrom(coins, (i) => ({ pair: "", source: "coinbase", on: i === 0 }),
    (e) => typeof e.pair === "string",
    (e, i) => ({
      pair: e.pair,
      source: typeof e.source === "string" ? e.source : "coinbase", // keep one we don't know; validation flags it
      on: i === 0 ? true : e.on !== false,
    }), COIN_SLOTS);
}

export function slotsToCoins(slots) {
  const { list, slotOf } = slotsToList(slots, (s) => !!s.pair,
    (s, i) => ({ pair: s.pair, source: s.source, on: i === 0 ? true : !!s.on }));
  return { coins: list, slotOf };
}

export const COIN_SOURCES = Object.freeze(["coinbase", "finnhub"]);

// The id of the coin list a slot needs, or null: no list for a source this
// flasher doesn't know (the slot shows its pair as text and the error says why),
// and none for Finnhub without a key.
export function coinListId(source, key) {
  if (!COIN_SOURCES.includes(source) || (source === "finnhub" && !key)) return null;
  return `${source}|${source === "finnhub" ? key : ""}`;
}

// What a coin row shows. st: fieldState for "coins"; key: the Finnhub key as it
// stands; listKey: the key the Finnhub lists use (app.js sets it once a key box
// is left); loaded, failed: the lists by id. id is the list to ask for, null when
// none is wanted. state: "ok" (list here), "loading", "failed", "none" (no list:
// no key, or a source we don't know) or "idle" (greyed: nothing is loaded).
export function coinRowState(st, slot, key, { listKey = key, loaded, failed }) {
  const greyed = st !== "on";
  const off = !slot.on;
  const id = greyed ? null : coinListId(slot.source, listKey);
  const state = greyed ? "idle" : !id ? "none" : loaded.has(id) ? "ok" : failed.has(id) ? "failed" : "loading";
  const keyless = !key;
  return {
    id, state, greyed, keyless,
    // Finnhub needs the key, but a stored keyless Finnhub coin stays selected, with its error.
    finnhubDisabled: greyed || (keyless && slot.source !== "finnhub"),
    pickDisabled: greyed || off || state !== "ok",
    manualDisabled: greyed || off,
    checkDisabled: greyed || off || !slot.pair || !COIN_SOURCES.includes(slot.source) || (slot.source === "finnhub" && keyless),
  };
}

export function moveSlot(slots, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= slots.length || j >= slots.length) return slots;
  const out = slots.map((s) => ({ ...s }));
  [out[i], out[j]] = [out[j], out[i]];
  out[0].on = true;
  return out;
}

// The index in config.stocks of form slot `slot`, or -1 when that slot isn't stored.
export const stockIndexOfSlot = (state, slot) => (state.stockSlotOf || []).indexOf(slot);

// The index in config.coins of form slot `slot`, or -1 when that slot isn't stored.
export const coinIndexOfSlot = (state, slot) => (state.coinSlotOf || []).indexOf(slot);

export function applyCoinSlots(state) {
  const { coins, slotOf } = slotsToCoins(state.coinSlots);
  state.config.coins = coins;
  state.coinSlotOf = slotOf;
}

export function applySlots(state) {
  const { stocks, slotOf } = slotsToStocks(state.stockSlots);
  state.config.stocks = stocks;
  state.config.ticker = state.stockSlots[0].symbol;
  state.stockSlotOf = slotOf;
}

// The slots again from f.config (an import, after a flash), for each list the
// config has. A list it lacks (a target without stocks or coins, once
// filterSupported has been through) is left alone: applySlots would blank the
// ticker and applyCoinSlots would add coins: []. Coin slots waiting for their
// new source's list to check their pair (slot.verify) keep waiting, matched by
// pair and source.
export function rederiveSlots(f) {
  if (Array.isArray(f.config.stocks)) {
    f.stockSlots = stockSlots(f.config.stocks);
    applySlots(f);
  }
  if (Array.isArray(f.config.coins)) {
    const id = (s) => `${s.source}|${s.pair}`;
    const pending = new Set(f.coinSlots.filter((s) => s.verify).map(id));
    f.coinSlots = coinSlots(f.config.coins).map((s) => (pending.has(id(s)) ? { ...s, verify: true } : s));
    applyCoinSlots(f);
  }
}

// After a flash: `now`, what the new firmware reports, decides. The form goes
// over the board's new settings, cut to what that firmware has. -> the paths it
// has that the form didn't offer.
export function applyAfterFlash(f, boardConfig, now) {
  const fresh = newlyOffered(f.supported, now);
  f.supported = now;
  f.config = filterSupported(mergeConfig(fromBoard(boardConfig), f.config), now);
  // The Clock box reads night even where it only shows its note; formToRequest strips it.
  if (!f.config.night) f.config.night = { ...DEFAULTS.night };
  // A flash that doesn't erase keeps /display.json, and a board too old to report
  // its level left only fromBoard's default in the form: the Buddy's own level
  // stands unless the user chose one. After an erase the form's value is the
  // one to keep: the board only has its default.
  const chosen = (f.touched && f.touched.has("brightness")) || (f.imported || []).includes("brightness");
  const flow = FLOWS[f.flow];
  if (!chosen && !(flow && flow.erase) && now.has("brightness") && boardConfig && Number.isInteger(boardConfig.brightness)) {
    f.config.brightness = boardConfig.brightness;
  }
  rederiveSlots(f);
  return fresh;
}

// "on": the deciding firmware supports it; "greyed": an installable release
// does (drawn disabled with S.form.needsNewer); "hidden": neither (spec §6.4).
export function fieldState(state, path) {
  if (state.supported && state.supported.has(path)) return "on";
  if (state.teaser && state.teaser.has(path)) return "greyed";
  return "hidden";
}

// A path matches itself, and a top-level key matches every path under it and
// back: "pages" <-> "pages.moon", "coins" <-> "coins[1].pair" or "coins.style".
const topOf = (p) => String(p).split(/[.[]/)[0];
function listed(list, key) {
  if (!list) return false;
  return [...list].some((k) => k === key
    || (topOf(k) === topOf(key) && (k === topOf(k) || key === topOf(key))));
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

// Errors on stocks and coins keyed like the form: stocks[k]... -> stockslot.<slot
// of k>, coins[k]... -> coinslot.<slot of k>. With the list offered, the list's
// own error (and `ticker` for stocks) lands on slot 1 (an existing message there
// wins); without, every key of that list is dropped.
// Works for both the form's own errors and the Buddy's SET errors.
function remapListErrors(state, out, { list, slotKey, slotOf, extra }) {
  const re = new RegExp(`^${list}\\[(\\d+)\\]`);
  for (const [key, msg] of Object.entries(out)) {
    const m = re.exec(key);
    if (!m) continue;
    delete out[key];
    const slot = slotOf ? slotOf[Number(m[1])] : Number(m[1]);
    out[`${slotKey}.${slot}`] = msg;
  }
  if (fieldState(state, list) !== "on") {
    // Not offered by the deciding firmware: the list is not validated.
    for (const key of Object.keys(out)) {
      if (key === list || key.startsWith(`${list}[`) || key.startsWith(`${slotKey}.`)) delete out[key];
    }
  } else {
    for (const key of [...extra, list]) {
      if (key in out) {
        if (!out[`${slotKey}.0`]) out[`${slotKey}.0`] = out[key];
        delete out[key];
      }
    }
  }
}

// (Name kept from phase 1: it remaps coin errors to coin slots too.)
export function remapStockErrors(state, errors) {
  const out = { ...errors };
  remapListErrors(state, out, { list: "stocks", slotKey: "stockslot", slotOf: state.stockSlotOf, extra: ["ticker"] });
  remapListErrors(state, out, { list: "coins", slotKey: "coinslot", slotOf: state.coinSlotOf, extra: [] });
  return out;
}

// Delete, in place, the raw server errors that belong to form slot `slot`
// (kind "stock": stocks[k]..., ticker, stocks; kind "coin": coins[k]..., coins),
// so editing that slot clears them.
export function dropSlotErrors(state, errors, slot, kind = "stock") {
  const coin = kind === "coin";
  const re = coin ? /^coins\[(\d+)\]/ : /^stocks\[(\d+)\]/;
  const slotOf = coin ? state.coinSlotOf : state.stockSlotOf;
  const listKeys = coin ? ["coins"] : ["ticker", "stocks"];
  for (const key of Object.keys(errors)) {
    const m = re.exec(key);
    if (m) {
      const at = slotOf ? slotOf[Number(m[1])] : Number(m[1]);
      if (at === slot) delete errors[key];
    } else if (slot === 0 && listKeys.includes(key)) {
      delete errors[key];
    }
  }
}

// Every error in the form, keyed like the firmware's: { key: message }.
// zones: the time zone table; a zone that isn't in it is an error, since the
// clock rule comes from it.
export function formErrors(state, zones) {
  const out = {};
  const { errors } = validateConfig(state.config);
  for (const [key, raw] of Object.entries(errors)) out[key] = fieldMessage(key, raw);
  // Stock slots: list errors point at their slot; an empty slot that is on is an error.
  const mapped = remapStockErrors(state, out);
  for (const key of Object.keys(out)) delete out[key];
  Object.assign(out, mapped);
  (state.stockSlots || []).forEach((s, i) => {
    if (fieldState(state, "stocks") === "on" && i > 0 && s.on && !s.symbol) out[`stockslot.${i}`] = S.errors.stockSlotEmpty;
  });
  if (fieldState(state, "coins") === "on") {
    const keyless = !String(state.config.stock_key || "").trim();
    (state.coinSlots || []).forEach((s, i) => {
      if (i > 0 && s.on && !s.pair) out[`coinslot.${i}`] = S.errors.coinSlotEmpty;
      else if (s.on && s.pair && s.source === "finnhub" && keyless && !out[`coinslot.${i}`]) out[`coinslot.${i}`] = S.errors.coinNeedsKey;
    });
  }
  if (!out.tz_name && zones && ruleForZone(zones, state.config.tz_name) === null) {
    out.tz_name = S.errors.tzUnknown;
  }
  if (locationMissing(state)) out.location = S.errors.location;
  // Not offered by the deciding firmware: the Clock box is hidden, so its errors must not block Save.
  if (fieldState(state, "night.enabled") !== "on") {
    for (const key of Object.keys(out)) {
      if (key === "night" || key.startsWith("night.") || key === "clock_format") delete out[key];
    }
  }
  if (fieldState(state, "brightness") !== "on") delete out.brightness;
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

// The one-line summary under the city search (GUI review, 2026-10-12):
// "Munich, Bavaria, Germany · 48.1374, 11.5755 · Europe/Berlin". The place
// label only when the values came from the city search (placeLabel); from
// an import or the board, just the coordinates and the zone. "" when nothing
// is set. Plain text: app.js puts it in with textContent.
export function locationSummary(config, placeLabel = "") {
  const c = config || {};
  const lat = String(c.lat ?? "").trim();
  const lon = String(c.lon ?? "").trim();
  const zone = String(c.tz_name ?? "").trim();
  const coords = lat && lon ? `${lat}, ${lon}` : lat || lon;
  return [String(placeLabel || "").trim(), coords, zone].filter(Boolean).join(" · ");
}

// The pages that show the theme's colours, in the order a theme change tries
// them (Eric, 2026-10-12): the face never uses the theme.
export const THEMED_PAGES = Object.freeze(["clock", "date", "weather", "moon", "stock", "github"]);

// Night mode's hours are stored 0-23; the labels follow the clock format.
export const hourLabel = (h, format) => {
  if (format !== "12h") return `${String(h).padStart(2, "0")}:00`;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
};
// The brightness sliders show percent; the board stores 8-255.
export const levelToPercent = (l) => Math.round((l * 100) / 255);
export const percentToLevel = (p) => Math.max(8, Math.min(255, Math.round((p * 255) / 100)));

// The preview page a changed setting belongs to, so the preview can jump
// there (GUI review, Eric 2026-10-12): a page key, "stay" (hold the current
// page without jumping), or null (no jump and no hold: Wi-Fi, or a page
// switched off). "check.stock", "check.coin" and "check.github" are the Check buttons: on
// the press and again when a fresh result arrives. A theme change goes to the first themed page that is on and
// shown, or stays when there is
// none. "coinslot.N" (a coin slot) goes to the coin page. For the other keys, whether the page is shown is the preview's call.
export function previewPageFor(key, config) {
  switch (key) {
    case "temp_unit": case "wind_unit": case "lat": case "lon": case "city": return "weather";
    case "tz_name": case "tz_rule": case "clock_format": return "clock";
    case "ticker": case "stock_key": case "check.stock": return "stock";
    case "check.coin": return "coin";
    case "github_user": case "check.github": return "github";
    case "mount": return "face";
    case "brightness": return "stay"; // the preview doesn't simulate brightness
    case "theme": {
      const shown = pageList(config);
      return THEMED_PAGES.find((p) => shown.includes(p)) || "stay";
    }
    default: break;
  }
  if (typeof key === "string" && (key === "night" || key.startsWith("night."))) return "clock";
  if (typeof key === "string" && key.startsWith("stockslot.")) return "stock";
  if (typeof key === "string" && key.startsWith("coinslot.")) return "coin";
  if (typeof key === "string" && key.startsWith("pages.")) {
    const page = key.slice("pages.".length);
    return config && config.pages && config.pages[page] === true ? page : null;
  }
  return null;
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
