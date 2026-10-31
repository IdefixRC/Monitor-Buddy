import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS, PAGE_KEYS, validateConfig, validateWifi, mergeConfig,
  makeBackup, readBackup, backupFileName, BadBackup,
  BASELINE_PATHS, supportedPaths, filterSupported, unsupportedKeys, newlyOffered, flattenPaths,
} from "../web/js/settings.js";

const DEFAULTS = {
  mount: "left", theme: 2, github_user: "IdefixRC", tz_name: "Asia/Singapore", tz_rule: "<+08>-8",
  ticker: "AAPL", stock_key: "", lat: "1.3119", lon: "103.8149", temp_unit: "celsius", wind_unit: "kmh",
  pages: { face: true, clock: true, date: true, weather: true, moon: true, stock: true, github: true },
};

const bad = (patch, key) => {
  const r = validateConfig(patch);
  assert.equal(r.ok, false, `${JSON.stringify(patch)} should be rejected`);
  assert.ok(typeof r.errors[key] === "string" && r.errors[key].length > 0,
    `error under ${key}, got ${JSON.stringify(r.errors)}`);
  assert.deepEqual(Object.keys(r.errors), [key]);
};
const good = (patch) => {
  const r = validateConfig(patch);
  assert.deepEqual(r, { ok: true, errors: {} }, JSON.stringify(patch));
};

// -- constants ------------------------------------------------------------

test("KEYS are the firmware's keys in the firmware's order", () => {
  assert.deepEqual(KEYS, ["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
    "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages"]);
});

test("PAGE_KEYS are the firmware's pages in order", () => {
  assert.deepEqual(PAGE_KEYS, ["face", "clock", "date", "weather", "moon", "stock", "github"]);
});

// -- validateConfig: whole object -----------------------------------------

test("the default config is valid", () => good(DEFAULTS));
test("an empty patch is valid", () => good({}));
test("unknown keys and v are ignored", () => good({ v: 1, future_key: true, theme: 3 }));

test("a non-object config is rejected under 'config'", () => {
  for (const v of [null, [1], "x", 5, undefined]) bad(v, "config");
});

test("every bad value is reported, each under its own key", () => {
  const r = validateConfig({ theme: 9, lat: "95", mount: "up", ticker: "aapl", temp_unit: "kelvin",
    pages: { clock: "yes" } });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(),
    ["lat", "mount", "pages.clock", "temp_unit", "theme", "ticker"]);
});

test("firmware error messages", () => {
  assert.equal(validateConfig({ theme: 9 }).errors.theme, "must be a whole number 0-4");
  assert.equal(validateConfig({ lat: "95" }).errors.lat, "a number from -90 to 90");
  assert.equal(validateConfig({ lon: "-181" }).errors.lon, "a number from -180 to 180");
  assert.equal(validateConfig({ mount: "up" }).errors.mount, 'must be "left" or "right"');
  assert.equal(validateConfig({ temp_unit: "kelvin" }).errors.temp_unit, 'must be "celsius" or "fahrenheit"');
  assert.equal(validateConfig({ wind_unit: "knots" }).errors.wind_unit, 'must be "kmh" or "mph"');
  assert.equal(validateConfig({ ticker: "aapl" }).errors.ticker, "1-10 characters: A-Z, 0-9, . and -");
  assert.equal(validateConfig({ github_user: "a/b" }).errors.github_user, "0-39 characters: letters, digits and -");
  assert.equal(validateConfig({ stock_key: "abc&symbol=X" }).errors.stock_key, "0-64 characters: letters, digits, _ and -");
  assert.equal(validateConfig({ tz_name: "" }).errors.tz_name, "1-64 characters: letters, digits and / _ + -");
  assert.equal(validateConfig({ tz_rule: "" }).errors.tz_rule, "1-64 characters of a POSIX TZ rule");
  assert.equal(validateConfig({ pages: { clock: "yes" } }).errors["pages.clock"], "must be true or false");
  assert.equal(validateConfig({ pages: 1 }).errors.pages, "must be an object");
});

// -- mount ------------------------------------------------------------------

test("mount accepts left and right", () => { good({ mount: "left" }); good({ mount: "right" }); });
test("mount rejects 'up'", () => bad({ mount: "up" }, "mount"));
test("mount is case-sensitive", () => bad({ mount: "Left" }, "mount"));
test("mount must be text", () => bad({ mount: 1 }, "mount"));

// -- theme ------------------------------------------------------------------

test("theme accepts 0 and 4", () => { good({ theme: 0 }); good({ theme: 4 }); });
test("theme 9 is rejected", () => bad({ theme: 9 }, "theme"));
test("theme -1 is rejected", () => bad({ theme: -1 }, "theme"));
test("theme 2.5 is rejected", () => bad({ theme: 2.5 }, "theme"));
test("theme as text is rejected", () => bad({ theme: "2" }, "theme"));

// -- github_user ------------------------------------------------------------

test("github_user accepts a name with a hyphen", () => good({ github_user: "octo-cat" }));
test("github_user accepts empty (hides the page)", () => good({ github_user: "" }));
test("github_user accepts 39 characters", () => good({ github_user: "a".repeat(39) }));
test("github_user rejects 40 characters", () => bad({ github_user: "a".repeat(40) }, "github_user"));
test("github_user rejects a slash", () => bad({ github_user: "a/b" }, "github_user"));
test("github_user rejects an underscore", () => bad({ github_user: "a_b" }, "github_user"));
test("github_user must be text", () => bad({ github_user: 5 }, "github_user"));

// -- tz_name ----------------------------------------------------------------

test("tz_name accepts Etc/GMT+8", () => good({ tz_name: "Etc/GMT+8" }));
test("tz_name accepts Europe/Berlin", () => good({ tz_name: "Europe/Berlin" }));
test("tz_name accepts 64 characters", () => good({ tz_name: "a".repeat(64) }));
test("tz_name rejects 65 characters", () => bad({ tz_name: "a".repeat(65) }, "tz_name"));
test("tz_name rejects empty", () => bad({ tz_name: "" }, "tz_name"));
test("tz_name rejects a space", () => bad({ tz_name: "New York" }, "tz_name"));

// -- tz_rule ----------------------------------------------------------------

test("tz_rule accepts a rule with daylight saving", () => good({ tz_rule: "CET-1CEST,M3.5.0,M10.5.0/3" }));
test("tz_rule accepts a fixed-offset rule", () => good({ tz_rule: "<+08>-8" }));
test("tz_rule rejects empty", () => bad({ tz_rule: "" }, "tz_rule"));
test("tz_rule rejects a space", () => bad({ tz_rule: "EST 5" }, "tz_rule"));
test("tz_rule rejects 65 characters", () => bad({ tz_rule: "A".repeat(65) }, "tz_rule"));

// -- ticker -----------------------------------------------------------------

test("ticker accepts AVGO and BRK.B", () => { good({ ticker: "AVGO" }); good({ ticker: "BRK.B" }); });
test("ticker accepts 10 characters", () => good({ ticker: "ABCDEFGHIJ" }));
test("ticker rejects 11 characters", () => bad({ ticker: "ABCDEFGHIJK" }, "ticker"));
test("ticker rejects lower case", () => bad({ ticker: "aapl" }, "ticker"));
test("ticker rejects empty", () => bad({ ticker: "" }, "ticker"));

// -- stock_key --------------------------------------------------------------

test("stock_key accepts empty (hides the page)", () => good({ stock_key: "" }));
test("stock_key accepts letters, digits, _ and -", () => good({ stock_key: "abc_DEF-123" }));
test("stock_key accepts 64 characters", () => good({ stock_key: "k".repeat(64) }));
test("stock_key rejects 65 characters", () => bad({ stock_key: "k".repeat(65) }, "stock_key"));
test("stock_key rejects abc&symbol=X", () => bad({ stock_key: "abc&symbol=X" }, "stock_key"));

// -- lat / lon --------------------------------------------------------------

test("lat accepts 48.1374, -90, 90, +5, .5 and 5.", () => {
  for (const v of ["48.1374", "-90", "90", "+5", ".5", "5."]) good({ lat: v });
});
test("lat accepts 15 characters", () => good({ lat: "1.2345678901234" }));
test("lat rejects 16 characters", () => bad({ lat: "1.23456789012345" }, "lat"));
test("lat 95 is out of range", () => bad({ lat: "95" }, "lat"));
test("lat 91 is out of range", () => bad({ lat: "91" }, "lat"));
test("lat -90.0001 is out of range", () => bad({ lat: "-90.0001" }, "lat"));
test("lat rejects leading space", () => bad({ lat: " 48" }, "lat"));
test("lat rejects leading newline", () => bad({ lat: "\n48" }, "lat"));
test("lat rejects hex 0x1A", () => bad({ lat: "0x1A" }, "lat"));
test("lat rejects exponent 1e1", () => bad({ lat: "1e1" }, "lat"));
test("lat rejects nan", () => bad({ lat: "nan" }, "lat"));
test("lat rejects inf", () => bad({ lat: "inf" }, "lat"));
test("lat rejects empty", () => bad({ lat: "" }, "lat"));
test("lat rejects a lone dot", () => bad({ lat: "." }, "lat"));
test("lat rejects two dots", () => bad({ lat: "1.2.3" }, "lat"));
test("lat rejects a sign in the middle", () => bad({ lat: "1-2" }, "lat"));
test("lat must be text, not a number", () => bad({ lat: 48 }, "lat"));
test("lon accepts -180 and 180", () => { good({ lon: "-180" }); good({ lon: "180" }); });
test("lon -181 is out of range", () => bad({ lon: "-181" }, "lon"));
test("lon 180.5 is out of range", () => bad({ lon: "180.5" }, "lon"));
test("lon rejects 0x1A", () => bad({ lon: "0x1A" }, "lon"));

// -- units ------------------------------------------------------------------

test("temp_unit accepts celsius and fahrenheit", () => { good({ temp_unit: "celsius" }); good({ temp_unit: "fahrenheit" }); });
test("temp_unit rejects kelvin", () => bad({ temp_unit: "kelvin" }, "temp_unit"));
test("wind_unit accepts kmh and mph", () => { good({ wind_unit: "kmh" }); good({ wind_unit: "mph" }); });
test("wind_unit rejects knots", () => bad({ wind_unit: "knots" }, "wind_unit"));

// -- pages ------------------------------------------------------------------

test("pages accepts a partial object of booleans", () => good({ pages: { stock: false } }));
test("pages.clock 'yes' is rejected under pages.clock", () => bad({ pages: { clock: "yes" } }, "pages.clock"));
test("pages.moon 1 is rejected under pages.moon", () => bad({ pages: { moon: 1 } }, "pages.moon"));
test("pages as a number is rejected under pages", () => bad({ pages: 1 }, "pages"));
test("pages as null is rejected under pages", () => bad({ pages: null }, "pages"));
test("pages as an array is rejected under pages", () => bad({ pages: [true] }, "pages"));
test("unknown page names are ignored", () => good({ pages: { future: "x" } }));

// -- validateWifi -----------------------------------------------------------

test("wifi accepts an SSID and an 8-character password", () => {
  assert.deepEqual(validateWifi({ ssid: "home", password: "12345678" }), { ok: true, errors: {} });
});
test("wifi accepts an empty password (open network)", () => {
  assert.deepEqual(validateWifi({ ssid: "cafe", password: "" }), { ok: true, errors: {} });
});
test("wifi accepts a 32-character SSID and a 63-character password", () => {
  assert.equal(validateWifi({ ssid: "s".repeat(32), password: "p".repeat(63) }).ok, true);
});
test("wifi rejects an empty SSID", () => {
  assert.deepEqual(validateWifi({ ssid: "", password: "12345678" }),
    { ok: false, errors: { "wifi.ssid": "must be 1-32 characters" } });
});
test("wifi rejects a 33-character SSID", () => {
  assert.deepEqual(validateWifi({ ssid: "s".repeat(33), password: "12345678" }),
    { ok: false, errors: { "wifi.ssid": "must be 1-32 characters" } });
});
test("wifi counts SSID bytes, not characters", () => {
  // 17 x U+00E9 is 17 characters but 34 UTF-8 bytes.
  assert.equal(validateWifi({ ssid: "é".repeat(17), password: "" }).ok, false);
  assert.equal(validateWifi({ ssid: "é".repeat(16), password: "" }).ok, true);
});
test("wifi rejects a 7-character password", () => {
  assert.deepEqual(validateWifi({ ssid: "home", password: "1234567" }),
    { ok: false, errors: { "wifi.password": "must be empty or 8-63 characters" } });
});
test("wifi rejects a 64-character password", () => {
  assert.equal(validateWifi({ ssid: "home", password: "p".repeat(64) }).ok, false);
});
test("wifi requires the password field (missing)", () => {
  assert.deepEqual(validateWifi({ ssid: "home" }),
    { ok: false, errors: { "wifi.password": "must be text (empty for an open network)" } });
});
test("wifi requires the password field (null)", () => {
  assert.deepEqual(validateWifi({ ssid: "home", password: null }),
    { ok: false, errors: { "wifi.password": "must be text (empty for an open network)" } });
});
test("wifi reports both problems at once", () => {
  assert.deepEqual(Object.keys(validateWifi({ ssid: "", password: "short" }).errors).sort(),
    ["wifi.password", "wifi.ssid"]);
});
test("wifi SSID must be text", () => {
  assert.equal(validateWifi({ ssid: 5, password: "" }).ok, false);
});
test("wifi must be an object", () => {
  assert.deepEqual(validateWifi(null), { ok: false, errors: { wifi: "must be an object" } });
});

// -- mergeConfig ------------------------------------------------------------

test("merge changes only the patched key", () => {
  assert.deepEqual(mergeConfig(DEFAULTS, { ticker: "AVGO" }), { ...DEFAULTS, ticker: "AVGO" });
});
test("merge keeps the other pages", () => {
  const m = mergeConfig(DEFAULTS, { pages: { stock: false } });
  assert.deepEqual(m.pages, { face: true, clock: true, date: true, weather: true, moon: true, stock: false, github: true });
});
test("merge drops unknown keys, v and unknown pages", () => {
  const m = mergeConfig(DEFAULTS, { v: 1, future_key: 1, pages: { future: true }, theme: 4 });
  assert.deepEqual(m, { ...DEFAULTS, theme: 4 });
});
test("merge does not change its inputs", () => {
  const base = structuredClone(DEFAULTS), patch = { pages: { moon: false } };
  const m = mergeConfig(base, patch);
  m.pages.face = false;
  assert.deepEqual(base, DEFAULTS);
  assert.deepEqual(patch, { pages: { moon: false } });
});
test("merge into an empty base keeps only the patch", () => {
  assert.deepEqual(mergeConfig({}, { theme: 1, pages: { face: false } }), { theme: 1, pages: { face: false } });
});

// -- backups ----------------------------------------------------------------

const NOW = new Date("2026-10-11T08:30:00Z");

test("makeBackup wraps the config", () => {
  assert.deepEqual(makeBackup(DEFAULTS, "1.2.0", NOW),
    { monitor_buddy_backup: 1, fw: "1.2.0", saved: "2026-10-11T08:30:00.000Z", config: DEFAULTS });
});
test("makeBackup clones the config", () => {
  const cfg = structuredClone(DEFAULTS);
  const b = makeBackup(cfg, "1.2.0", NOW);
  cfg.pages.face = false;
  cfg.theme = 0;
  assert.deepEqual(b.config, DEFAULTS);
});
test("backup round trip returns the same config", () => {
  assert.deepEqual(readBackup(makeBackup(DEFAULTS, "1.2.0", NOW)), DEFAULTS);
});
test("backup survives JSON", () => {
  const text = JSON.stringify(makeBackup(DEFAULTS, "1.2.0", NOW));
  assert.deepEqual(readBackup(JSON.parse(text)), DEFAULTS);
});
test("a backup never contains wifi or password", () => {
  const text = JSON.stringify(makeBackup({ ...DEFAULTS, wifi: { ssid: "home", password: "secret99" } }, "1.2.0", NOW));
  assert.equal(text.includes("wifi"), false);
  assert.equal(text.includes("password"), false);
  assert.equal(text.includes("secret99"), false);
});
test("readBackup drops unknown keys, also inside pages", () => {
  const r = readBackup({ monitor_buddy_backup: 1, config: { theme: 3, wifi: { ssid: "x" }, v: 1,
    pages: { face: false, future: true } } });
  assert.deepEqual(r, { theme: 3, pages: { face: false } });
});
test("readBackup accepts a partial config", () => {
  assert.deepEqual(readBackup({ monitor_buddy_backup: 1, config: { ticker: "AVGO" } }), { ticker: "AVGO" });
});
test("readBackup rejects null", () => assert.throws(() => readBackup(null), BadBackup));
test("readBackup rejects an array", () => assert.throws(() => readBackup([]), BadBackup));
test("readBackup rejects text", () => assert.throws(() => readBackup("{}"), BadBackup));
test("readBackup rejects a missing marker", () => assert.throws(() => readBackup({ config: {} }), BadBackup));
test("readBackup rejects a non-numeric marker", () => assert.throws(() => readBackup({ monitor_buddy_backup: "1", config: {} }), BadBackup));
test("readBackup rejects a missing config", () => assert.throws(() => readBackup({ monitor_buddy_backup: 1 }), BadBackup));
test("readBackup rejects a config that is not an object", () => {
  assert.throws(() => readBackup({ monitor_buddy_backup: 1, config: [] }), BadBackup);
  assert.throws(() => readBackup({ monitor_buddy_backup: 1, config: "x" }), BadBackup);
  assert.throws(() => readBackup({ monitor_buddy_backup: 1, config: null }), BadBackup);
});
test("BadBackup is an Error with its own name", () => {
  try { readBackup(null); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof Error); assert.equal(e.name, "BadBackup"); }
});

test("backup file name uses the date", () => {
  assert.equal(backupFileName(new Date(2026, 9, 11, 14, 5)), "monitor-buddy-settings-2026-10-11.json");
});
test("backup file name zero-pads month and day", () => {
  assert.equal(backupFileName(new Date(2026, 0, 3, 23, 59)), "monitor-buddy-settings-2026-01-03.json");
});

// -- supported paths (spec §5.3) ------------------------------------------

test("BASELINE_PATHS are 1.2.0's 18 paths", () => {
  assert.deepEqual([...BASELINE_PATHS], ["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
    "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages.face", "pages.clock", "pages.date",
    "pages.weather", "pages.moon", "pages.stock", "pages.github"]);
  assert.ok(Object.isFrozen(BASELINE_PATHS));
});

test("a 1.2.0 GET supports exactly the baseline", () => {
  assert.deepEqual([...supportedPaths(DEFAULTS)].sort(), [...BASELINE_PATHS].sort());
});

test("supportedPaths ignores keys the flasher doesn't know and lists only reported pages", () => {
  const s = supportedPaths({ theme: 2, later: 1, pages: { face: true, coin: true } });
  assert.deepEqual([...s], ["theme", "pages.face"]);
});

test("filterSupported keeps only supported paths", () => {
  const supported = new Set(BASELINE_PATHS.filter((p) => p !== "wind_unit" && p !== "pages.moon"));
  const out = filterSupported(DEFAULTS, supported);
  assert.equal(Object.hasOwn(out, "wind_unit"), false);
  assert.equal(Object.hasOwn(out.pages, "moon"), false);
  assert.equal(out.pages.face, true);
  assert.equal(out.theme, 2);
});

test("unsupportedKeys names the top-level keys that lost something", () => {
  const supported = new Set(BASELINE_PATHS.filter((p) => p !== "wind_unit" && p !== "pages.moon"));
  assert.deepEqual(unsupportedKeys(DEFAULTS, supported), ["wind_unit", "pages"]);
  assert.deepEqual(unsupportedKeys(DEFAULTS, new Set(BASELINE_PATHS)), []);
});

test("newlyOffered lists what a flash adds", () => {
  assert.deepEqual(newlyOffered(new Set(["a", "b"]), new Set(["a", "b", "c"])), ["c"]);
  assert.deepEqual(newlyOffered(new Set(["a"]), new Set(["a"])), []);
});

test("flattenPaths opens groups and keeps lists and unknown keys whole", () => {
  assert.deepEqual(flattenPaths({ theme: 3, pages: { moon: false }, later: [1] }),
    [["theme", 3], ["pages.moon", false], ["later", [1]]]);
});
