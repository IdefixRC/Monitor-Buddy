import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULTS, formToRequest, badgesFor, helpFor, wifiChoices, formErrors, fromBoard,
  redactLog, stockMessage, githubMessage, addsSettings, newFormState,
  locationMissing, boardLocation, LOCATION_KEYS, parseRich, escapeRich,
  joinedWifi, resultKind, offered, WIFI_WAIT_MS, locationSummary, FLOWS, afterRecovery, setTicker,
  stockSlots, slotsToStocks, moveSlot, applySlots, stockIndexOfSlot, fieldState, STOCK_SLOTS,
  remapStockErrors, dropSlotErrors,
  COIN_SLOTS, coinSlots, slotsToCoins, applyCoinSlots, coinIndexOfSlot, previewPageFor,
  applyAfterFlash, rederiveSlots,
} from "../web/js/form.js";
import { KEYS, mergeConfig, BASELINE_PATHS, PATHS_BY_CFG, filterSupported, supportedPaths, validateConfig } from "../web/js/settings.js";
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
  // The two refusal screens keep Eric's own wording, "Please" included (2026-10-17).
  const ownWording = new Set(["S.notBuddy.parts", "S.notBuddy.chip"]);
  for (const [path, t] of texts) {
    assert.doesNotMatch(t, /!/, `${path} has an exclamation mark`);
    const banned = ownWording.has(path) ? /\b(simply|just)\b/i : /\b(please|simply|just)\b/i;
    assert.doesNotMatch(t, banned, `${path}: "${t}"`);
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

// ── Enter never submits (Eric, 2026-10-12) ────────────────

// Enter in a field submits a form implicitly, through its submit button. So
// the app has none: every button is type "button", and the form's submit
// event saves nothing. A new field or button can't bring the bug back.
const appSource = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");

test("no submit button anywhere in the app", () => {
  assert.doesNotMatch(appSource, /type:\s*["']submit["']/);
  const buttons = [...appSource.matchAll(/h\(\s*["']button["']\s*,\s*\{([^}]*)/g)];
  assert.ok(buttons.length >= 5, "found the app's buttons");
  for (const [call, attrs] of buttons) assert.match(attrs, /type:\s*["']button["']/, call);
});

test("the settings form's submit event only cancels", () => {
  const handlers = [...appSource.matchAll(/addEventListener\(\s*["']submit["']\s*,([^\n]*)/g)].map((m) => m[1].trim());
  assert.deepEqual(handlers, ["(e) => e.preventDefault());"]);
});

// ── Counts: singular for exactly 1 ────────────────────────

test("one follower, one repo, one setting", () => {
  assert.equal(S.check.github.ok(1, 1), "OK — 1 follower, 1 repo");
  assert.equal(S.check.github.ok(1, 11), "OK — 1 follower, 11 repos");
  assert.equal(S.check.github.ok(0, 2), "OK — 0 followers, 2 repos");
  assert.equal(githubMessage({ status: "ok", followers: 1, repos: 11 }), "OK — 1 follower, 11 repos");
  assert.equal(S.form.configImported(1), "Imported 1 setting from config.h.");
  assert.equal(S.form.configImported(12), "Imported 12 settings from config.h.");
  assert.equal(S.form.backupImported(1), "Imported 1 setting from the backup.");
});

// ── Hardware-test fixes (2026-10-12) ──────────────────────

test("a failed Wi-Fi join has its own title and points at the name too", () => {
  assert.equal(S.titles.wifiFailed, "Wi-Fi didn't connect");
  assert.notEqual(S.titles.wifiFailed, S.titles.result);
  assert.equal(S.result.wifiFailed("getafix"),
    "Couldn't join getafix. Check the network name (capitals count) and the password; I've opened my setup hotspot.");
});

test("the footer carries the copyright line LICENSE asks for", () => {
  const licence = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  const holder = licence.match(/Copyright \(c\) (\d{4}) (.+)/);
  assert.equal(S.about.copyright, `© ${holder[1]}`);
  assert.equal(S.about.author, holder[2].trim());
  assert.match(S.about.licenceUrl, /\/LICENSE$/);
});

// ── H: recovering a Buddy keeps what it saved (2026-10-12) ─

test("recovery flashes without erasing; the setup form after it doesn't flash", () => {
  assert.deepEqual(FLOWS.recover, { flash: true, erase: false });
  assert.deepEqual(FLOWS.setup, { flash: false, erase: false });
});

test("after a recovery flash: keep what was stored, else set the Buddy up", () => {
  assert.equal(afterRecovery({ ok: true, stored: true, config: {} }), "keep");
  assert.equal(afterRecovery({ ok: true, stored: false, config: {} }), "setup");
  assert.equal(afterRecovery({ ok: true, config: {} }), "setup");
  assert.equal(afterRecovery(null), "setup");
});

test("setting up after a recovery needs a location, and keeps the Wi-Fi it found", () => {
  assert.equal(locationMissing({ flow: "setup", location: [] }), true);
  assert.equal(locationMissing({ flow: "setup", location: [...LOCATION_KEYS] }), false);
  assert.equal(wifiChoices(INFO_SAVED, "setup")[0].value, "keep");
});

test("every flow with a form has its texts", () => {
  for (const flow of Object.keys(FLOWS).filter((k) => k !== "recover")) {
    assert.equal(typeof S.form.submit[flow], "string", `submit.${flow}`);
    assert.equal(typeof S.form.say[flow], "string", `say.${flow}`);
  }
});

// ── Supported paths in the form (spec §5.3) ───────────────

test("a form without a board offers the baseline", () => {
  const f = newFormState(DEFAULTS, { flow: "install" });
  assert.deepEqual([...f.supported].sort(), [...BASELINE_PATHS].sort());
});

test("a form from a board offers what its GET reported", () => {
  const f = newFormState(DEFAULTS, { flow: "change", supported: ["theme", "pages.face"] });
  assert.equal(offered(f, "theme"), true);
  assert.equal(offered(f, "pages.moon"), false);
});

test("the request carries only supported paths", () => {
  const f = newFormState(DEFAULTS, { flow: "change", supported: BASELINE_PATHS.filter((p) => p !== "wind_unit") });
  const r = formToRequest(f);
  assert.equal(Object.hasOwn(r.config, "wind_unit"), false);
  assert.equal(r.config.theme, DEFAULTS.theme);
});

test("badges match a group or list path to its top-level key and back", () => {
  assert.deepEqual(badgesFor("pages.moon", { added: ["pages"] }), ["new"]);
  assert.deepEqual(badgesFor("pages", { imported: ["pages.moon"] }), ["imported"]);
  assert.deepEqual(badgesFor("coins[1].pair", { added: ["coins"] }), ["new"]);
  assert.deepEqual(badgesFor("coins", { added: ["coins.style"] }), ["new"]);
  assert.deepEqual(badgesFor("pages.moon", { added: ["pages.face"] }), []);
});

// ── The flows pass the board's supported paths on (spec §5.3) ──

test("every form built from a GET passes that GET's supported paths", () => {
  const fromGet = appSource.match(/newFormState\(fromBoard\(got\.config\)[^)]*\)/g) || [];
  assert.ok(fromGet.length >= 3, "the GET-based forms");
  for (const call of fromGet) assert.match(call, /supported: supportedPaths\(got\.config\)/, call);
});

test("flash flows take supported from the picked release, not the running board", () => {
  assert.match(appSource, /function startFlashFlow[\s\S]*?supported: pathsForCfg\(app\.releases\[0\]\.cfg_v\)/);
  assert.match(appSource, /flow: "fresh"[\s\S]*?supported: pathsForCfg\(app\.releases\[0\]\.cfg_v\)/);
});

test("changing the firmware version recomputes what the form offers", () => {
  assert.match(appSource, /f\.supported = new Set\(pathsForCfg\(entry\.cfg_v\)\)/);
});

test("the form knows what an installable release could add", () => {
  assert.match(appSource, /f\.teaser = installablePaths\(app\.releases\)/);
});

test("afterFlash sends what the flash added to the review form", () => {
  assert.match(appSource, /const fresh = applyAfterFlash\(f, got\.config, supportedPaths\(got\.config\)\);/);
  assert.match(appSource, /const added = \[\.\.\.new Set\(\[\.\.\.\(got\.added \|\| \[\]\), \.\.\.fresh\]\)\];/);
  const f = newFormState(DEFAULTS, { flow: "upgrade", supported: BASELINE_PATHS });
  const now = new Set(PATHS_BY_CFG[2]);
  assert.ok(applyAfterFlash(f, mergeConfig(DEFAULTS, {}), now).includes("stocks"));
  assert.equal(f.supported, now);
});

// Replaced in coin-page Task 7: every switch is built, and fieldState hides or
// greys each one for the picked firmware (the pin below).
test("the page switches follow the picked firmware", () => {
  assert.match(appSource, /fieldState\(f, `pages\.\$\{p\}`\)/);
  // What phase 1 pinned: a page the firmware doesn't have isn't shown (hidden), and
  // one only a newer release has is greyed with that release named.
  assert.match(appSource, /const st = fieldState\(f, `pages\.\$\{p\}`\);\s*el\.hidden = st === "hidden";\s*input\.disabled = st === "greyed";/);
  assert.match(appSource, /firstWith\(`pages\.\$\{p\}`\)[\s\S]{0,120}newerNote\(release\.version\)/);
});

test("the backup import leaves out what the board doesn't support", () => {
  assert.match(appSource, /unsupportedKeys\(cfg, f\.supported\)/);
  assert.ok(typeof S.form.backupPartly === "function");
  const text = S.form.backupPartly(11, ["wind_unit"]);
  assert.match(text, /wind_unit/);
  assert.doesNotMatch(text, /!|\bplease\b|\bsimply\b|\bjust\b/i);
});

test("editing the ticker keeps the first stock in step (afterFlash keeps it)", () => {
  const cfg = structuredClone(DEFAULTS);
  setTicker(cfg, "AVGO");
  assert.deepEqual(cfg.stocks, [{ symbol: "AVGO", on: true }]);
  const v12 = { ...structuredClone(DEFAULTS), ticker: "IBM" };
  delete v12.stocks;   // what a 1.2 board's GET looks like
  assert.equal(mergeConfig(fromBoard(v12), cfg).ticker, "AVGO");
});

// ── Stock slots (spec stocks-and-coins §6.1, D15) ─────────

test("stockSlots: five slots, slot 1 always on, empty slots off", () => {
  const s = stockSlots([{ symbol: "MSFT", on: true }, { symbol: "AVGO", on: false }]);
  assert.equal(s.length, STOCK_SLOTS);
  assert.deepEqual(s[0], { symbol: "MSFT", on: true });
  assert.deepEqual(s[1], { symbol: "AVGO", on: false });
  assert.deepEqual(s[4], { symbol: "", on: false });
  assert.equal(stockSlots([{ symbol: "X", on: false }])[0].on, true);
});

test("slotsToStocks keeps switched-off entries and drops empty slots", () => {
  const slots = [{ symbol: "A", on: true }, { symbol: "", on: false }, { symbol: "C", on: false }, { symbol: "D", on: true }, { symbol: "", on: true }];
  const { stocks, slotOf } = slotsToStocks(slots);
  assert.deepEqual(stocks, [{ symbol: "A", on: true }, { symbol: "C", on: false }, { symbol: "D", on: true }]);
  assert.deepEqual(slotOf, [0, 2, 3]);
});

test("moveSlot swaps and keeps slot 1 on", () => {
  const slots = stockSlots([{ symbol: "A", on: true }, { symbol: "B", on: false }]);
  const moved = moveSlot(slots, 1, -1);
  assert.deepEqual(moved[0], { symbol: "B", on: true });
  assert.deepEqual(moved[1], { symbol: "A", on: true });
  assert.equal(moveSlot(slots, 0, -1), slots);   // out of range: unchanged
});

test("applySlots writes stocks and ticker", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  f.stockSlots = stockSlots([{ symbol: "NVDA", on: true }, { symbol: "IBM", on: false }]);
  applySlots(f);
  assert.equal(f.config.ticker, "NVDA");
  assert.deepEqual(f.config.stocks, [{ symbol: "NVDA", on: true }, { symbol: "IBM", on: false }]);
});

test("fromBoard seeds stocks from a 1.2 board's ticker (K9)", () => {
  assert.deepEqual(fromBoard({ ticker: "AVGO" }).stocks, [{ symbol: "AVGO", on: true }]);
});

test("the request's ticker is the first stock (K10)", () => {
  const f = newFormState({ ...DEFAULTS, ticker: "OLD", stocks: [{ symbol: "NEW", on: true }] }, { flow: "change", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  assert.equal(formToRequest(f).config.ticker, "NEW");
});

test("a 1.2 board's request carries no stocks", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED });
  assert.equal(Object.hasOwn(formToRequest(f).config, "stocks"), false);
});

test("fieldState: on, greyed when installable, else hidden", () => {
  const base = { flow: "change", info: INFO_SAVED };
  assert.equal(fieldState(newFormState(DEFAULTS, { ...base, supported: [...BASELINE_PATHS, "stocks"] }), "stocks"), "on");
  assert.equal(fieldState(newFormState(DEFAULTS, { ...base, teaser: ["stocks"] }), "stocks"), "greyed");
  assert.equal(fieldState(newFormState(DEFAULTS, base), "stocks"), "hidden");
});

test("formErrors: an empty slot that is on, and a bad ticker in slot 3", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  f.stockSlots = [{ symbol: "AAPL", on: true }, { symbol: "", on: true }, { symbol: "bad!", on: false }, { symbol: "", on: false }, { symbol: "", on: false }];
  applySlots(f);
  const e = formErrors(f, zones);
  assert.equal(e["stockslot.1"], S.errors.stockSlotEmpty);
  assert.ok(e["stockslot.2"]);
});

test("formErrors: stock errors are not reported when stocks aren't offered", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: BASELINE_PATHS });
  f.config.ticker = "";
  const e = formErrors(f, zones);
  assert.ok(e.ticker);
  assert.deepEqual(Object.keys(e).filter((k) => k === "stocks" || k.startsWith("stocks[") || k.startsWith("stockslot.")), []);
});

test("formErrors: with stocks on, slot 1 carries the ticker and list errors", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  f.stockSlots[0] = { symbol: "", on: true };
  applySlots(f);
  const e = formErrors(f, zones);
  assert.ok(e["stockslot.0"]);
  assert.equal(e.ticker, undefined);
  assert.equal(e.stocks, undefined);
});

test("formErrors: after picking a release without stocks, a disabled slot's error is gone", () => {
  const f = newFormState(DEFAULTS, { flow: "fresh", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  f.stockSlots[2] = { symbol: "", on: true };
  applySlots(f);
  f.supported = new Set(BASELINE_PATHS);
  const e = formErrors(f, zones);
  assert.equal(e["stockslot.2"], undefined);
});

test("stockIndexOfSlot maps a form slot to its place in config.stocks", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"] });
  f.stockSlots = stockSlots([{ symbol: "AAPL", on: true }, { symbol: "", on: true }, { symbol: "MSFT", on: true }]);
  applySlots(f);
  assert.equal(stockIndexOfSlot(f, 2), 1);
  assert.equal(stockIndexOfSlot(f, 1), -1);
  assert.equal(stockIndexOfSlot(f, 0), 0);
});

// ── Server errors on stocks ───────────────────────────────

const STOCKS_ON = [...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on"];

test("remapStockErrors: stocks[k] points at the slot that was sent as entry k", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: STOCKS_ON });
  f.stockSlots = stockSlots([{ symbol: "A", on: true }, { symbol: "", on: true }, { symbol: "C", on: true }]);
  applySlots(f);
  assert.deepEqual(remapStockErrors(f, { "stocks[1].symbol": "x" }), { "stockslot.2": "x" });
});

test("remapStockErrors: with stocks on, ticker and the list land on slot 1; an existing message wins", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: STOCKS_ON });
  assert.deepEqual(remapStockErrors(f, { ticker: "t" }), { "stockslot.0": "t" });
  assert.deepEqual(remapStockErrors(f, { stocks: "l" }), { "stockslot.0": "l" });
  assert.deepEqual(remapStockErrors(f, { "stocks[0].symbol": "s", ticker: "t" }), { "stockslot.0": "s" });
  assert.deepEqual(remapStockErrors(f, { theme: "y" }), { theme: "y" });
});

test("remapStockErrors: drops stock keys when stocks aren't offered", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: BASELINE_PATHS });
  assert.deepEqual(remapStockErrors(f, { stocks: "l", "stocks[0].on": "o", "stockslot.1": "z", ticker: "t" }), { ticker: "t" });
});

test("dropSlotErrors: clears the raw server keys of one slot", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: STOCKS_ON });
  f.stockSlots = stockSlots([{ symbol: "A", on: true }, { symbol: "", on: true }, { symbol: "C", on: true }]);
  applySlots(f);
  const errs = { "stocks[1].symbol": "x", "stocks[0].symbol": "y", ticker: "t", stocks: "l", theme: "q" };
  dropSlotErrors(f, errs, 2);
  assert.deepEqual(errs, { "stocks[0].symbol": "y", ticker: "t", stocks: "l", theme: "q" });
  dropSlotErrors(f, errs, 0);
  assert.deepEqual(errs, { theme: "q" });
});

test("coinSlots: five slots, slot 1 on, empty ones off with the default source", () => {
  const s = coinSlots([{ pair: "BTC-USD", source: "coinbase", on: true }, { pair: "SOL-EUR", source: "finnhub", on: false }], "finnhub");
  assert.equal(s.length, COIN_SLOTS);
  assert.deepEqual(s[1], { pair: "SOL-EUR", source: "finnhub", on: false });
  assert.deepEqual(s[4], { pair: "", source: "finnhub", on: false });
});
test("slotsToCoins keeps switched-off coins and drops empty slots", () => {
  const { coins, slotOf } = slotsToCoins([{ pair: "BTC-USD", source: "coinbase", on: true }, { pair: "", source: "coinbase", on: false }, { pair: "ETH-EUR", source: "finnhub", on: false }, { pair: "", source: "coinbase", on: false }, { pair: "", source: "coinbase", on: false }]);
  assert.deepEqual(coins, [{ pair: "BTC-USD", source: "coinbase", on: true }, { pair: "ETH-EUR", source: "finnhub", on: false }]);
  assert.deepEqual(slotOf, [0, 2]);
});
test("a Finnhub coin that is on needs the key", () => {
  const all = [...PATHS_BY_CFG[2]];
  const f = newFormState({ ...DEFAULTS, stock_key: "" }, { flow: "change", info: INFO_SAVED, supported: all });
  f.coinSlots[1] = { pair: "SOL-EUR", source: "finnhub", on: true };
  applyCoinSlots(f);
  assert.equal(formErrors(f, zones)["coinslot.1"], S.errors.coinNeedsKey);
});
test("an empty coin slot that is on is an error", () => {
  const all = [...PATHS_BY_CFG[2]];
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED, supported: all });
  f.coinSlots[1] = { pair: "", source: "coinbase", on: true };
  applyCoinSlots(f);
  assert.equal(formErrors(f, zones)["coinslot.1"], S.errors.coinSlotEmpty);
});
test("coin errors stay out of a form whose firmware has no coins", () => {
  const f = newFormState(DEFAULTS, { flow: "change", info: INFO_SAVED });
  f.coinSlots[1] = { pair: "", source: "coinbase", on: true };
  applyCoinSlots(f);
  assert.deepEqual(Object.keys(formErrors(f, zones)).filter((k) => k.startsWith("coin")), []);
});
test("previewPageFor maps coin slots to the coin page", () => {
  assert.equal(previewPageFor("coinslot.2", { ...DEFAULTS }), "coin");
  assert.equal(previewPageFor("check.coin", { ...DEFAULTS }), "coin");
});
test("newFormState sets up coin slots and applyCoinSlots writes coins", () => {
  const f = newFormState(DEFAULTS, { flow: "change" });
  assert.equal("coinSource" in f, false); // no "New coins use" default any more
  assert.equal(f.coinSlots[1].source, "coinbase"); // empty slots start on Coinbase
  assert.equal(f.coinSlots.length, COIN_SLOTS);
  assert.deepEqual(f.coinSlotOf, [0]);
  f.coinSlots[2] = { pair: "ETH-EUR", source: "coinbase", on: false };
  applyCoinSlots(f);
  assert.deepEqual(f.config.coins.map((c) => c.pair), ["BTC-USD", "ETH-EUR"]);
  assert.equal(coinIndexOfSlot(f, 2), 1);
  assert.equal(coinIndexOfSlot(f, 1), -1);
});
test("remapStockErrors remaps coin errors to coin slots", () => {
  const all = [...PATHS_BY_CFG[2]];
  const f = newFormState(DEFAULTS, { flow: "change", supported: all });
  f.coinSlots[3] = { pair: "ETH-EUR", source: "coinbase", on: true };
  applyCoinSlots(f);
  const e = remapStockErrors(f, { "coins[1].pair": "x", coins: "l", theme: "q" });
  assert.deepEqual(e, { "coinslot.3": "x", "coinslot.0": "l", theme: "q" });
  const g = newFormState(DEFAULTS, { flow: "change" });
  assert.deepEqual(remapStockErrors(g, { "coins[0].pair": "x", coins: "l", "coinslot.1": "z", theme: "q" }), { theme: "q" });
});
test("dropSlotErrors handles coins", () => {
  const f = newFormState(DEFAULTS, { flow: "change" });
  f.coinSlots[2] = { pair: "ETH-EUR", source: "coinbase", on: true };
  applyCoinSlots(f);
  const errs = { "coins[0].pair": "a", "coins[1].pair": "b", coins: "l", "stocks[0].symbol": "s" };
  dropSlotErrors(f, errs, 2, "coin");
  assert.deepEqual(errs, { "coins[0].pair": "a", coins: "l", "stocks[0].symbol": "s" });
  dropSlotErrors(f, errs, 0, "coin");
  assert.deepEqual(errs, { "stocks[0].symbol": "s" });
});
test("a stored coin with an unknown source keeps it and is flagged on its slot", () => {
  const all = [...PATHS_BY_CFG[2]];
  const cfg = { ...DEFAULTS, coins: [{ pair: "BTC-USD", source: "coinbase", on: true }, { pair: "BTC-USD", source: "kraken", on: true }] };
  const f = newFormState(cfg, { flow: "change", supported: all });
  assert.equal(f.coinSlots[1].source, "kraken");
  applyCoinSlots(f);
  assert.equal(f.config.coins[1].source, "kraken");
  assert.ok(formErrors(f, zones)["coinslot.1"]);
});

// ── The coin section (coin-page Task 7) ───────────────────
test("the coin section loads each source's own list", () => {
  assert.match(appSource, /loadCoinList\(/);
  assert.match(appSource, /fieldState\(f, "coins"\)/);
});
// The board's GET after a flash, for a target of each settings format.
const BOARD_12 = () => filterSupported(mergeConfig(DEFAULTS, {}), new Set(BASELINE_PATHS));
const BOARD_13 = (extra = {}) => mergeConfig(DEFAULTS, extra);
const typedAvgo = (supported) => {
  const f = newFormState(DEFAULTS, { flow: "update", info: INFO_SAVED, supported });
  f.stockSlots[0] = { ...f.stockSlots[0], symbol: "AVGO" };
  applySlots(f);
  return f;
};

test("a flash to a 1.2 target keeps the ticker and adds nothing it doesn't know", () => {
  const f = typedAvgo(BASELINE_PATHS);
  const fresh = applyAfterFlash(f, BOARD_12(), new Set(BASELINE_PATHS));
  assert.deepEqual(fresh, []);
  assert.equal(f.config.ticker, "AVGO");
  assert.equal("stocks" in f.config, false);
  assert.equal("coins" in f.config, false, "Export backup must not carry coins: []");
  const { config } = formToRequest(f);
  assert.equal(config.ticker, "AVGO");
  assert.equal("stocks" in config, false);
  assert.equal("coins" in config, false);
  assert.equal("coin" in config.pages, false);
  assert.deepEqual(validateConfig(config).errors, {});
});

test("a flash to a 1.3 target re-derives the slots and keeps pending checks", () => {
  const f = typedAvgo(PATHS_BY_CFG[2]);
  f.coinSlots[1] = { pair: "SOL-EUR", source: "finnhub", on: true, verify: true }; // waiting for its list
  f.coinSlots[2] = { pair: "ETH-EUR", source: "coinbase", on: false };
  applyCoinSlots(f);
  const fresh = applyAfterFlash(f, BOARD_13(), supportedPaths(DEFAULTS));
  assert.deepEqual(fresh, []);
  assert.deepEqual(f.stockSlots.map((s) => s.symbol), ["AVGO", "", "", "", ""]);
  assert.equal(f.config.ticker, "AVGO");
  assert.deepEqual(f.coinSlots.slice(0, 3).map((s) => s.pair), ["BTC-USD", "SOL-EUR", "ETH-EUR"]);
  assert.equal(f.coinSlots[1].verify, true);
  assert.equal(f.coinSlots[2].verify, undefined);
  assert.deepEqual(f.coinSlotOf, [0, 1, 2]);
  assert.equal(formToRequest(f).config.coins.some((c) => "verify" in c), false);
});

test("a flash that brings stocks and coins fills their slots and says so", () => {
  const f = newFormState(DEFAULTS, { flow: "upgrade", supported: BASELINE_PATHS });
  const fresh = applyAfterFlash(f, BOARD_13(), supportedPaths(DEFAULTS));
  assert.ok(fresh.includes("stocks") && fresh.includes("coins") && fresh.includes("pages.coin"));
  assert.equal(f.stockSlots[0].symbol, "AAPL");
  assert.equal(f.coinSlots[0].pair, "BTC-USD");
});

// The review form after a flash to a 1.2 target has neither list.
const reviewOn12 = () => {
  const f = typedAvgo(BASELINE_PATHS);
  applyAfterFlash(f, BOARD_12(), new Set(BASELINE_PATHS));
  return f;
};

test("an import on a 1.2 target keeps the ticker, with or without the lists in the form", () => {
  for (const f of [typedAvgo(BASELINE_PATHS), reviewOn12()]) {
    f.config = mergeConfig(f.config, { ticker: "TSLA" }); // what both imports do
    rederiveSlots(f);
    assert.equal(f.config.ticker, "TSLA");
    assert.equal(formToRequest(f).config.ticker, "TSLA");
    assert.equal("stocks" in formToRequest(f).config, false);
    assert.equal("coins" in formToRequest(f).config, false);
  }
  const g = reviewOn12();
  rederiveSlots(g);
  assert.equal("coins" in g.config, false);
  // A flash flow keeps the lists while 1.2 is picked, so 1.3 can still be picked after an import.
  const h = typedAvgo(BASELINE_PATHS);
  h.config = mergeConfig(h.config, { ticker: "TSLA" });
  rederiveSlots(h);
  assert.equal(h.stockSlots[0].symbol, "TSLA");
});

test("an import keeps a pending check when its coin stays", () => {
  const f = newFormState(DEFAULTS, { flow: "change", supported: PATHS_BY_CFG[2] });
  f.coinSlots[0] = { ...f.coinSlots[0], verify: true };
  rederiveSlots(f);
  assert.equal(f.coinSlots[0].verify, true);
});

test("a requested focus is applied after screen() focuses its heading", () => {
  // screen() focuses the heading after build(); the form's requested focus must come later.
  assert.doesNotMatch(appSource, /slotInputs\[Number\(slotAt\[1\]\)\]\.focus\(\);\s*\}\);/);
  assert.match(appSource, /const heading = h\("h1"[\s\S]*?const wanted = build\(main\);[\s\S]*?wanted\.focus\(\);[\s\S]*?document\.activeElement !== wanted\) heading\.focus/);
});

test("a source change's pending pair check lives in the form state", () => {
  // Kept on the slot (moves with it on a Move), ended only by a loaded or failed list.
  assert.match(appSource, /source: input\.value, verify: true/);
  assert.match(appSource, /\(state === "ok" \|\| state === "failed"\) && f\.coinSlots\[i\]\.verify\) setVerify\(false\)/);
  assert.doesNotMatch(appSource, /let verify = false/);
  const f = newFormState(DEFAULTS, { flow: "change" });
  f.coinSlots[0] = { ...f.coinSlots[0], verify: true };
  const moved = moveSlot(f.coinSlots, 0, 1);
  assert.equal(moved[1].verify, true);
  f.coinSlots = moved;
  applyCoinSlots(f);
  assert.equal(Object.hasOwn(f.config.coins[0], "verify"), false, "never stored");
});
test("checked coin prices are keyed by source and pair", async () => {
  const { coinPriceKey } = await import("../web/js/coins.js");
  assert.equal(coinPriceKey("coinbase", "BTC-USD"), "coinbase:BTC-USD");
  assert.notEqual(coinPriceKey("finnhub", "BTC-USD"), coinPriceKey("coinbase", "BTC-USD"));
  assert.match(appSource, /const askedKey = coinPriceKey\(asked\[1\], asked\[0\]\);/);
  assert.match(appSource, /\[askedKey\]: res\.price/);
});

// ── Final fixes on the coin page (2026-11-02) ─────────────

const GET_12 = JSON.parse(readFileSync(new URL("./fixtures/backup-1.2.0.json", import.meta.url), "utf8")).config;

test("a 1.2 board's config gets the 1.3 coin defaults when it enters the form", () => {
  assert.ok(!("coins" in GET_12) && !("coin" in GET_12.pages), "the fixture is a 1.2 config");
  const board = fromBoard(GET_12);
  assert.deepEqual(board.coins, [{ pair: "BTC-USD", source: "coinbase", on: true }]);
  assert.equal(board.pages.coin, true);
  board.coins[0].pair = "X";   // a copy, not the frozen DEFAULTS
  assert.equal(DEFAULTS.coins[0].pair, "BTC-USD");
  // A 1.3 board's own coins and page switch are kept.
  const own = fromBoard({ ...GET_12, coins: [{ pair: "ETH-EUR", source: "finnhub", on: false }], pages: { ...GET_12.pages, coin: false } });
  assert.deepEqual(own.coins, [{ pair: "ETH-EUR", source: "finnhub", on: false }]);
  assert.equal(own.pages.coin, false);
});

test("with 1.3 picked, a 1.2 board's form shows slot 1 BTC-USD and the coin page on", () => {
  const f = newFormState(fromBoard(GET_12), { flow: "change", info: INFO_SAVED, supported: PATHS_BY_CFG[2] });
  assert.equal(f.coinSlots[0].pair, "BTC-USD");
  assert.equal(f.coinSlots[0].source, "coinbase");
  assert.equal(f.coinSlots[0].on, true);
  assert.equal(f.config.pages.coin, true);
  const req = formToRequest(f);
  assert.deepEqual(req.config.coins, [{ pair: "BTC-USD", source: "coinbase", on: true }]);
  assert.equal(req.config.pages.coin, true);
});

test("a 1.2 target still gets nothing coin-related", () => {
  const f = newFormState(fromBoard(GET_12), { flow: "change", info: INFO_SAVED, supported: BASELINE_PATHS });
  const req = formToRequest(f);
  assert.ok(!("coins" in req.config));
  assert.ok(!("coin" in req.config.pages));
});

test("the app builds the page switches in shown order and counts stock only with a key", () => {
  assert.match(appSource, /SHOWN_ORDER\.map\(\(p\) => \{\s*const row = switchRow/);
  assert.doesNotMatch(appSource, /PAGE_KEYS\.map\(\(p\) => \{\s*const row = switchRow/);
  assert.match(appSource, /\(p !== "stock" \|\| !!f\.config\.stock_key\)/);
});

test("the Check line shows the device's price and a not-found result reaches the preview", () => {
  assert.match(appSource, /const coinPrice = formatCoinPrice;/);
  assert.doesNotMatch(appSource, /toLocaleString/);
  assert.match(appSource, /states\[askedKey\] = "notfound"/);
  assert.match(appSource, /coinStates: states/);
});

// ── Compact stock and coin rows (coin-page Task 10) ───────
test("one Finnhub key, two boxes: Stock's and Coins' both set stock_key", () => {
  // Both are textFields for stock_key; Coins' registers its error under an alias, so neither replaces the other.
  assert.match(appSource, /const stockKey = textField\(\{\s*key: "stock_key",/);
  assert.match(appSource, /const coinKeyField = textField\(\{\s*key: "stock_key", alias: "stock_key@coins",/);
  assert.match(appSource, /set: \(v\) => setKey\(v, stockKey\.input\)/);
  assert.match(appSource, /set: \(v\) => setKey\(v, coinKeyField\.input\)/);
  // One value: typing in one mirrors into the other (never into the box being typed in).
  assert.match(appSource, /const setKey = \(v, from\) => \{\s*f\.config\.stock_key = v\.trim\(\);[\s\S]{0,120}for \(const box of keyBoxes\) if \(box !== from\) box\.value = v;/);
  // Leaving either box refreshes the Finnhub lists.
  assert.match(appSource, /for \(const box of keyBoxes\) box\.addEventListener\("change", \(\) => \{ coinKey = f\.config\.stock_key; refresh\(\); \}\);/);
  // refresh() looks errors up by the slot's setting, not its map key.
  assert.match(appSource, /for \(const slot of slots\.values\(\)\) \{\s*const \{ key \} = slot;\s*const msg = errs\[key\];/);
  assert.match(S.form.coinKeyHint, /Coinbase needs none/);
});
test("the coin section has no default-source group", () => {
  assert.doesNotMatch(appSource, /coinDefault|coindef|coin-default|f\.coinSource/);
  assert.equal(S.form.coinDefaultSource, undefined);
  assert.equal(S.form.coinDefaultHint, undefined);
  const css = readFileSync(new URL("../web/css/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /coin-default/);
});
test("slots 2-5 sit in fold-outs that open on an error inside or on focus sent there", () => {
  assert.match(appSource, /foldOut\("stock", slotRows\.slice\(1\)[\s\S]*?slotRows\.slice\(1\)\.map\(\(r\) => `stockslot\.\$\{r\.i\}`\), slotsNote\);/);
  assert.match(appSource, /foldOut\("coin", coinRows\.slice\(1\)[\s\S]*?coinRows\.slice\(1\)\.map\(\(r\) => `coinslot\.\$\{r\.i\}`\)\);/);
  // A shown error inside opens it (refresh) and keeps it open (toggle).
  assert.match(appSource, /const hasError = \(\) => errorKeys\.some\(\(k\) => slots\.get\(k\) && !slots\.get\(k\)\.error\.hidden\);/);
  assert.match(appSource, /if \(hasError\(\) && !fold\.open\) \{ fold\.open = true; f\.folds\[name\] = true; \}/);
  assert.match(appSource, /if \(!fold\.open && hasError\(\)\) fold\.open = true;/);
  // Open or closed is form state; focus into slot 2-5 (after a Move) opens it first.
  assert.match(appSource, /open: !!f\.folds\[name\]/);
  assert.ok(appSource.includes(String.raw`const into = /^(stock|coin)slot\.([1-9]\d*)$/.exec(focus || "");
  if (into) f.folds[into[1]] = true;`));
  // Closed, the title lists what's inside.
  assert.equal(S.form.moreStocks, "More stocks (up to 4)");
  assert.equal(S.form.moreCoins, "More coins (up to 4)");
  assert.equal(S.form.moreStocksList(["NVDA", "MSFT"], 1), "More stocks: NVDA, MSFT (1 off)");
  assert.equal(S.form.moreCoinsList(["ETH-GBP", "SOL-EUR"], 0), "More coins: ETH-GBP, SOL-EUR");
});
test("compact rows: the pick, then the tools in the brief's order", () => {
  // Stock: On, ticker | Check, up, down (slot 1: no On, no up; slot 5: no down).
  assert.match(appSource, /h\("div", \{ class: "slot__pick" \}, onBox && onBox\.el, input\),\s*slotTools\(check, i > 0 \? up : null, i < STOCK_SLOTS - 1 \? down : null\)\),\s*error, result\);/);
  // Coin: On, source, coin, currency (or the typed pair) | Check, up, down; hints, error and result under the row.
  assert.match(appSource, /const pickBox = h\("div", \{ class: "coin-pick" \}, coinInput, datalist, currency\);/);
  assert.match(appSource, /h\("div", \{ class: "slot__pick" \}, onBox && onBox\.el, srcGroup, pickBox, manual\),\s*slotTools\(check, i > 0 \? up : null, i < COIN_SLOTS - 1 \? down : null\)\),\s*loadingHint, failedHint, error, result\);/);
  // The arrows sit together at the right end of the tools.
  assert.match(appSource, /check, h\("span", \{ class: "slot__moves" \}, up \|\| gap\("up"\), down \|\| gap\("down"\)\)/);
  // Moves are icon buttons named for their slot.
  assert.match(appSource, /btn\(dir < 0 \? "↑" : "↓", onclick, \{ class: "btn btn--secondary btn--icon", "aria-label": `\$\{text\}, \$\{name\}`/);
  // Finnhub can't be picked without a key; a stored keyless one stays selected.
  assert.match(appSource, /input\.disabled = greyed \|\| \(input === finnhubInput && keyless\);/);
  assert.match(appSource, /finnhubInput\.setAttribute\("aria-describedby", needKey\.id\);/);
  // The currency note is said once, and every currency select points at it.
  assert.match(appSource, /"aria-describedby": curNote\.id/);
  assert.equal((appSource.match(/S\.form\.coinCurrencyNote/g) || []).length, 1);
});

test("firmware without coins shows only the note in the Coins section", () => {
  assert.match(appSource, /coinFields\.hidden = st !== "on";/);
  assert.match(appSource, /section\(S\.form\.sections\.coin, coinFields, coinsNote\)/);
});

test("the greyed note offers the picker only where there is one", () => {
  assert.match(appSource, /flow\.flash \? S\.form\.needsNewer\(version\) : S\.form\.needsUpdate\(version\)/);
  assert.equal(S.form.needsUpdate("1.3.0"), "Available from firmware 1.3.0. Update your Buddy to use this feature.");
  assert.doesNotMatch(appSource, /S\.form\.needsNewer\((release|firstStocks|firstCoins)\.version\)/);
});

test("the note about stocks 2-5 sits in their fold-out's title, visible while closed", () => {
  assert.match(appSource, /h\("summary", \{ class: "advanced__summary" \}, title, hint\)/);
  assert.match(appSource, /const slotsNote = h\("span", \{ class: "advanced__hint" \}\);/);
  assert.match(appSource, /`stockslot\.\$\{r\.i\}`\), slotsNote\);/);
});

test("confetti after every finished flash, not after a plain settings save", () => {
  assert.match(appSource, /if \(kind === "connected" \|\| \(installed && kind !== "wifiFailed"\)\) confetti\(\);/);
  assert.equal((appSource.match(/\bconfetti\(\);/g) || []).length, 1);
});

test("a silent board gets a second look after the board check, once", () => {
  assert.match(appSource, /else await checkThenPathB\(\{ askAgain: true \}\);/);
  assert.match(appSource, /if \(askAgain\) return probeAndRouteOnce\(\{ afterCheck: true \}\);/);
  assert.match(appSource, /else if \(afterCheck\) await closeThenPathB\(\);/);
  // Trouble seen before writing (a boot loop, download mode) doesn't ask again.
  assert.match(appSource, /return afterCheck \? closeThenPathB\(\) : checkThenPathB\(\);/);
});
