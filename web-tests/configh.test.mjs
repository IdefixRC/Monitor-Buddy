import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfigH } from "../web/js/configh.js";

const table = { "Asia/Singapore": "<+08>-8", "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3" };
const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const PAGES = { face: true, clock: true, date: true, weather: true, moon: true, stock: true, github: true };

test("1.1.0 example imports every key", () => {
  const r = parseConfigH(fixture("config.h.v1.1.0"), table);
  assert.deepEqual(r.config, {
    mount: "left", theme: 2, github_user: "IdefixRC", tz_name: "Asia/Singapore", tz_rule: "<+08>-8",
    ticker: "AAPL", stock_key: "", lat: "1.3119", lon: "103.8149", temp_unit: "celsius",
    wind_unit: "kmh", pages: PAGES });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.defaulted, []);
});

test("1.0.1 has no mounting location, so mount stays at the form's value", () => {
  const r = parseConfigH(fixture("config.h.v1.0.1"), table);
  assert.equal("mount" in r.config, false);
  assert.deepEqual(r.defaulted, ["mount"]);
});

test("current example with TZ_RULE empty uses the table", () => {
  const r = parseConfigH(fixture("config.h.current"), table);
  assert.equal(r.config.tz_rule, "<+08>-8");
});

test("a non-empty TZ_RULE wins over the table and the offset", () => {
  const r = parseConfigH('#define TIMEZONE "Asia/Singapore"\n#define TZ_RULE "EST5EDT,M3.2.0,M11.1.0"\n#define TZ_OFFSET_HOURS 8\n', table);
  assert.equal(r.config.tz_rule, "EST5EDT,M3.2.0,M11.1.0");
});

test("unknown zone falls back to TZ_OFFSET_HOURS", () => {
  const r = parseConfigH('#define TIMEZONE "Mars/Olympus"\n#define TZ_OFFSET_HOURS -5\n', table);
  assert.equal(r.config.tz_name, "Mars/Olympus");
  assert.equal(r.config.tz_rule, "<-05>5");
});

test("values, comments and oddities", () => {
  const r = parseConfigH([
    "/* #define THEME 4 */",
    "// #define TICKER \"MSFT\"",
    "#define MOUNTING_LOCATION RIGHT   // comment",
    '#define STOCKKEY "abc123" // key',
    '#define TEMP "fahrenheit"',
    "#define SHOW_MOON false",
    "#define SOMETHING_ELSE 42",
  ].join("\n"), table);
  assert.equal(r.config.mount, "right");
  assert.equal(r.config.stock_key, "abc123");
  assert.equal(r.config.temp_unit, "fahrenheit");
  assert.equal(r.config.pages.moon, false);
  assert.equal("theme" in r.config, false);
  assert.equal("ticker" in r.config, false);
  assert.deepEqual(r.skipped, ["SOMETHING_ELSE"]);
});

test("the placeholder Finnhub key counts as empty", () => {
  assert.equal(parseConfigH('#define STOCKKEY "xxxxxxx"\n', table).config.stock_key, "");
});
