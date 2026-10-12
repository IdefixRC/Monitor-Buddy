import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULTS, formToRequest, badgesFor, helpFor, wifiChoices, formErrors, fromBoard,
  redactLog, stockMessage, githubMessage, addsSettings, newFormState,
  locationMissing, boardLocation, LOCATION_KEYS, parseRich, escapeRich,
  joinedWifi, resultKind, WIFI_WAIT_MS, locationSummary,
} from "../web/js/form.js";
import { KEYS, mergeConfig } from "../web/js/settings.js";
import { parseConfigH } from "../web/js/configh.js";
import { S } from "../web/js/strings.js";

const zones = JSON.parse(readFileSync(new URL("../web/vendor/posix_tz_db/zones.json", import.meta.url)));
const example = readFileSync(new URL("../config/config.h.example", import.meta.url), "utf8");

const INFO_SAVED = { ok: true, cmd: "INFO", fw: "1.2.0", cfg_v: 1, wifi: { saved: true, ssid: "HomeNet", connected: true } };
const INFO_NONE = { ok: true, cmd: "INFO", fw: "1.2.0", cfg_v: 1, wifi: { saved: false, ssid: "", connected: false } };

const state = (wifi) => ({ config: structuredClone(DEFAULTS), wifi });

// ── formToRequest: the spec §4 Wi-Fi rules ────────────────

test("Wi-Fi on with new credentials: wifi is included", () => {
  const r = formToRequest(state({ configure: true, choice: "new", ssid: "HomeNet", password: "secret123" }));
  assert.deepEqual(r.wifi, { ssid: "HomeNet", password: "secret123" });
  assert.deepEqual(r.config, DEFAULTS);
});

test("Wi-Fi on with keep: wifi is omitted", () => {
  const r = formToRequest(state({ configure: true, choice: "keep", ssid: "typed", password: "typed123" }));
  assert.equal("wifi" in r, false);
});

test("Wi-Fi off: wifi is omitted, whatever was typed", () => {
  const r = formToRequest(state({ configure: false, choice: "new", ssid: "HomeNet", password: "secret123" }));
  assert.equal("wifi" in r, false);
});

test("an open network sends an empty password, not a missing one", () => {
  const r = formToRequest(state({ configure: true, choice: "new", ssid: "Cafe", password: "" }));
  assert.deepEqual(r.wifi, { ssid: "Cafe", password: "" });
});

test("the request's config is a copy", () => {
  const s = state({ configure: false });
  const r = formToRequest(s);
  r.config.pages.face = false;
  assert.equal(s.config.pages.face, true);
});

// ── wifiChoices ───────────────────────────────────────────

const values = (choices) => choices.map((c) => c.value);

test("keep is offered, first, when the board reports saved Wi-Fi", () => {
  const c = wifiChoices(INFO_SAVED, "change");
  assert.deepEqual(values(c), ["keep", "new"]);
  assert.match(c[0].label, /HomeNet/);
  assert.deepEqual(values(wifiChoices(INFO_SAVED, "update")), ["keep", "new"]);
});

test("no keep when the board has no saved Wi-Fi", () => {
  assert.deepEqual(values(wifiChoices(INFO_NONE, "change")), ["new"]);
});

test("no keep for a fresh install: the erase wipes the saved Wi-Fi", () => {
  assert.deepEqual(values(wifiChoices(INFO_SAVED, "fresh")), ["new"]);
});

test("path B: keep is offered for upgrades, not for a fresh install", () => {
  const up = wifiChoices(null, "upgrade");
  assert.deepEqual(values(up), ["keep", "new"]);
  assert.equal(up[0].label, S.form.wifiKeepUnknown);
  assert.deepEqual(values(wifiChoices(null, "install")), ["new"]);
});

test("a new form defaults to the first choice and Wi-Fi on", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED });
  assert.equal(f.wifi.configure, true);
  assert.equal(f.wifi.choice, "keep");
  assert.equal(newFormState(DEFAULTS, { flow: "install", info: null }).wifi.choice, "new");
});

// ── badgesFor ─────────────────────────────────────────────

test("keys in added get New, imported keys get Imported", () => {
  assert.deepEqual(badgesFor("ticker", { added: ["ticker"], imported: [] }), ["new"]);
  assert.deepEqual(badgesFor("ticker", { added: [], imported: ["ticker"] }), ["imported"]);
  assert.deepEqual(badgesFor("ticker", { added: ["ticker"], imported: ["ticker"] }), ["new", "imported"]);
  assert.deepEqual(badgesFor("theme", { added: ["ticker"], imported: ["mount"] }), []);
  assert.deepEqual(badgesFor("theme", {}), []);
});

test("pages: the firmware's pages.<name> paths and an imported pages object", () => {
  assert.deepEqual(badgesFor("pages.moon", { added: ["pages.moon"] }), ["new"]);
  assert.deepEqual(badgesFor("pages.clock", { added: ["pages.moon"] }), []);
  assert.deepEqual(badgesFor("pages.clock", { imported: ["pages"] }), ["imported"]);
  assert.deepEqual(badgesFor("pages", { added: ["pages.moon"] }), ["new"]);
});

// ── helpFor and the help texts ────────────────────────────

test("every setting has a help text", () => {
  for (const key of [...KEYS, "wifi.ssid", "wifi.password", "wifi.configure", "wifi.keep", "city"]) {
    assert.equal(typeof S.help[key], "string", `S.help["${key}"] is missing`);
    assert.ok(S.help[key].trim().length > 10, `S.help["${key}"] is empty`);
    assert.equal(helpFor(key), S.help[key]);
  }
});

test("helpFor throws for an unknown key", () => {
  assert.throws(() => helpFor("no_such_setting"), /no_such_setting/);
});

test("the Finnhub help links to the sign-up page", () => {
  assert.match(helpFor("stock_key"), /\[finnhub\.io\/register\]\(https:\/\/finnhub\.io\/register\)/);
});

// ── Defaults, board values, validation ────────────────────

test("DEFAULTS are config.h.example's values, as the firmware is built", () => {
  const { config } = parseConfigH(example, zones);
  assert.deepEqual(mergeConfig(DEFAULTS, config), DEFAULTS);
  assert.deepEqual(Object.keys(DEFAULTS).sort(), [...KEYS].sort());
});

test("fromBoard drops the template's placeholder Finnhub key", () => {
  assert.equal(fromBoard({ ...DEFAULTS, stock_key: "xxxxxxx" }).stock_key, "");
  assert.equal(fromBoard({ ...DEFAULTS, stock_key: "real" }).stock_key, "real");
});

test("formErrors: valid defaults have none", () => {
  assert.deepEqual(formErrors(newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED }), zones), {});
});

test("formErrors: a time zone not in the table is a field error", () => {
  const f = newFormState({ ...DEFAULTS, tz_name: "Mars/Olympus" }, { flow: "change", info: INFO_SAVED });
  const e = formErrors(f, zones);
  assert.deepEqual(Object.keys(e), ["tz_name"]);
  assert.equal(e.tz_name, S.errors.tzUnknown);
});

test("formErrors: Wi-Fi is checked only when new credentials are chosen", () => {
  const f = newFormState(DEFAULTS, { flow: "install", info: null, location: ["lat", "lon", "tz_name"] });
  f.wifi = { configure: true, choice: "new", ssid: "", password: "short" };
  assert.deepEqual(Object.keys(formErrors(f, zones)).sort(), ["wifi.password", "wifi.ssid"]);
  f.wifi.configure = false;
  assert.deepEqual(formErrors(f, zones), {});
});

test("formErrors: messages come from strings.js, keyed like the firmware's", () => {
  const f = newFormState({ ...DEFAULTS, lat: "95", theme: 9 }, { flow: "change", info: INFO_SAVED });
  const e = formErrors(f, zones);
  assert.equal(e.lat, S.errors.lat);
  assert.equal(e.theme, S.errors.theme);
});

// ── Checks, logs and the update note ──────────────────────

test("stock check messages, including the free-plan wording", () => {
  assert.equal(stockMessage({ status: "ticker_not_found" }),
    "Ticker not found, or not covered by a free Finnhub key (the free plan covers US stocks only).");
  assert.equal(stockMessage({ status: "key_rejected" }), S.check.stock.key_rejected);
  assert.match(stockMessage({ status: "ok", price: 1234.5 }, "AVGO"), /AVGO \$1,234\.50/);
  assert.match(githubMessage({ status: "ok", followers: 42, repos: 17 }), /42 followers, 17 repos/);
  assert.equal(githubMessage({ status: "not_found" }), S.check.github.not_found);
});

test("logs never show the Finnhub key or a Wi-Fi password", () => {
  const line = '@MB SET {"id":3,"config":{"stock_key":"abc123","ticker":"AAPL"},"wifi":{"ssid":"Home","password":"p\\"w"}}';
  const out = redactLog(line);
  assert.doesNotMatch(out, /abc123|p\\"w/);
  assert.match(out, /"stock_key":"<redacted>"/);
  assert.match(out, /"password":"<redacted>"/);
  assert.match(out, /"ticker":"AAPL"/);
  assert.equal(redactLog('{"stock_key":""}'), '{"stock_key":""}'); // empty stays visibly empty
});

test("the update note appears only when the format version goes up", () => {
  assert.equal(addsSettings({ cfg_v: 2 }, { cfg_v: 1 }), true);
  assert.equal(addsSettings({ cfg_v: 1 }, { cfg_v: 1 }), false);
  assert.equal(addsSettings({ cfg_v: 2 }, null), false);
});

// ── Copy rules ────────────────────────────────────────────

test("copy: no exclamation marks, no please, simply or just", () => {
  const texts = [];
  const walk = (v, path) => {
    if (typeof v === "string") texts.push([path, v]);
    else if (typeof v === "function") texts.push([path, String(v("X", "Y", "Z"))]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(S, "S");
  assert.ok(texts.length > 100);
  for (const [path, t] of texts) {
    assert.doesNotMatch(t, /!/, `${path} has an exclamation mark`);
    assert.doesNotMatch(t, /\b(please|simply|just)\b/i, `${path}: "${t}"`);
  }
});

// ── A fresh install needs a location (Eric, 2026-10-11) ───

test("a fresh install can't go ahead on the built-in location", () => {
  for (const flow of ["fresh", "install"]) {
    const f = newFormState(DEFAULTS, { flow, info: null });
    assert.equal(locationMissing(f), true, flow);
    assert.equal(formErrors(f, zones).location, S.errors.location);
  }
});

test("picking a place, typing all three values, or importing them is enough", () => {
  const f = newFormState(DEFAULTS, { flow: "install", info: null });
  f.location = ["lat", "lon"];
  assert.equal(locationMissing(f), true, "the time zone is still missing");
  f.location = [...LOCATION_KEYS];
  assert.equal(locationMissing(f), false);
  assert.equal("location" in formErrors(f, zones), false);
});

test("path A updates and settings changes keep the board's location", () => {
  for (const flow of ["change", "review", "update"]) {
    assert.equal(locationMissing(newFormState(DEFAULTS, { flow, info: INFO_SAVED })), false, flow);
  }
});

test("a path B upgrade needs a location too, unless an import or the user gave it", () => {
  // No INFO on path B: skipping the config.h import would write the built-in place.
  const f = newFormState(DEFAULTS, { flow: "upgrade", info: null });
  assert.equal(locationMissing(f), true);
  assert.equal(formErrors(f, zones).location, S.errors.location);
  // An import (config.h or backup) marks all three keys as given.
  const imported = newFormState(DEFAULTS, { flow: "upgrade", info: null, location: [...LOCATION_KEYS] });
  assert.equal(locationMissing(imported), false);
  assert.equal("location" in formErrors(imported, zones), false);
  // Two of the three are not enough.
  assert.equal(locationMissing(newFormState(DEFAULTS, { flow: "upgrade", info: null, location: ["lat", "lon"] })), true);
});

test("a board's saved, non-default location counts; defaults or unsaved don't", () => {
  const mine = { ...DEFAULTS, lat: "48.1374", lon: "11.5755", tz_name: "Europe/Berlin" };
  assert.deepEqual(boardLocation({ stored: true, config: mine }), [...LOCATION_KEYS]);
  assert.deepEqual(boardLocation({ stored: false, config: mine }), []);
  assert.deepEqual(boardLocation({ stored: true, config: { ...DEFAULTS } }), []);
  assert.deepEqual(boardLocation(null), []);
});

// ── Markup and escaping ───────────────────────────────────

test("parseRich reads bold, code and https links", () => {
  assert.deepEqual(parseRich("Join **Monitor-Buddy-Setup**, use `AAPL`, see [docs](https://x.io/a)."), [
    { type: "text", text: "Join " },
    { type: "strong", text: "Monitor-Buddy-Setup" },
    { type: "text", text: ", use " },
    { type: "code", text: "AAPL" },
    { type: "text", text: ", see " },
    { type: "link", text: "docs", href: "https://x.io/a" },
    { type: "text", text: "." },
  ]);
  assert.deepEqual(parseRich("[no](http://insecure.example)"), [{ type: "text", text: "[no](http://insecure.example)" }]);
});

test("escaped board data stays plain text", () => {
  const ssid = "**x** [a](https://evil.example) `c` back\slash";
  const tokens = parseRich(S.result.connected(escapeRich(ssid)));
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "text");
  assert.equal(tokens[0].text, S.result.connected(ssid));
});

test("every help text parses, and the Finnhub link survives", () => {
  for (const [key, text] of Object.entries(S.help)) {
    const tokens = parseRich(text);
    assert.ok(tokens.length > 0, key);
    assert.ok(tokens.every((t) => !t.text.includes("**")), `${key} has unparsed bold`);
  }
  assert.ok(parseRich(S.help.stock_key).some((t) => t.type === "link" && t.href === "https://finnhub.io/register"));
});

// ── The result after a save ───────────────────────────────

test("the result follows spec §4", () => {
  const up = { wifi: { saved: true, ssid: "Home", connected: true } };
  const down = { wifi: { saved: true, ssid: "Home", connected: false } };
  const none = { wifi: { saved: false, ssid: "", connected: false } };
  const sent = { config: {}, wifi: { ssid: "Home", password: "secret123" } };
  assert.equal(resultKind(sent, up), "connected");
  assert.equal(resultKind(sent, down), "wifiFailed");
  assert.equal(resultKind(sent, { wifi: { saved: true, ssid: "Other", connected: true } }), "wifiFailed");
  assert.equal(resultKind({ config: {} }, none), "hotspot");
  assert.equal(resultKind({ config: {} }, up), "saved");
  assert.equal(joinedWifi(null, "Home"), false);
  assert.equal(WIFI_WAIT_MS, 30000);
});

// ── The place summary under the city search (GUI review, 2026-10-12) ──

test("the summary names the place when it came from the city search", () => {
  const c = { lat: "48.1374", lon: "11.5755", tz_name: "Europe/Berlin" };
  assert.equal(locationSummary(c, "Munich, Bavaria, Germany"), "Munich, Bavaria, Germany · 48.1374, 11.5755 · Europe/Berlin");
});

test("from an import or the board: coordinates and zone only", () => {
  assert.equal(locationSummary({ lat: "1.3119", lon: "103.8149", tz_name: "Asia/Singapore" }), "1.3119, 103.8149 · Asia/Singapore");
});

test("missing parts are left out; nothing set gives an empty line", () => {
  assert.equal(locationSummary({ lat: "48.1", lon: "", tz_name: "" }), "48.1");
  assert.equal(locationSummary({ lat: "", lon: "", tz_name: "UTC" }), "UTC");
  assert.equal(locationSummary({}), "");
  assert.equal(locationSummary(null, ""), "");
});

test("the Advanced settings texts are the owner's wording", () => {
  assert.equal(S.form.advanced, "Advanced settings");
  assert.equal(S.form.advancedHint, "Allows you to tweak the data provided by City search.");
});
