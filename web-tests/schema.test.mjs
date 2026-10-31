// The flasher's settings engine against the same cases as the firmware
// (test/fixtures/settings-cases.json, merge cases), on the real schema and on
// the demo schema that mirrors test/test_schema/test_main.cpp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEMA, KEYS, PAGE_KEYS, validateWith, mergeWith, knownWith } from "../web/js/settings.js";

const cases = JSON.parse(readFileSync(new URL("../test/fixtures/settings-cases.json", import.meta.url), "utf8"));

// Mirrors DEMO in test/test_schema/test_main.cpp. KEEP the two the same: the
// shared cases fail on whichever side drifts.
const pairCheck = (s) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(s);
export const DEMO = [
  { name: "theme", kind: "int", min: 0, max: 4, error: "must be a whole number 0-4" },
  { name: "flags", kind: "group", children: [
    { name: "a", kind: "bool", error: "must be true or false" },
    { name: "b", kind: "bool", error: "must be true or false" }] },
  { name: "night", kind: "group", error: "start and end must differ", check: (g) => g.start !== g.end, children: [
    { name: "enabled", kind: "bool", error: "must be true or false" },
    { name: "start", kind: "int", min: 0, max: 23, error: "a whole hour 0-23" },
    { name: "end", kind: "int", min: 0, max: 23, error: "a whole hour 0-23" },
    { name: "brightness", kind: "int", min: 8, max: 255, error: "a whole number 8-255" }] },
  { name: "names", kind: "list", min: 1, max: 5, error: "1-5 entries",
    item: { kind: "text", min: 1, max: 10, chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-", error: "1-10 characters: A-Z, 0-9, . and -" } },
  { name: "coins", kind: "list", min: 1, max: 5, error: "1-5 entries", entryDefault: { pair: "BTC-USD", style: "coinbase" },
    fields: [
      { name: "pair", kind: "text", min: 3, max: 21, chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", check: pairCheck, error: "3-21 characters: A-Z, 0-9 and one -" },
      { name: "style", kind: "choice", words: ["finnhub", "coinbase"], error: 'must be "finnhub" or "coinbase"' }] },
];

const SECTIONS = { settings: SCHEMA, demo: DEMO };

for (const [section, schema] of Object.entries(SECTIONS)) {
  const { defaults, cases: list } = cases[section];
  for (const c of list.filter((x) => x.op === "merge")) {
    test(`${section}: ${c.name}`, () => {
      const current = mergeWith(schema, defaults, c.current || {});
      const r = validateWith(schema, c.patch, current);
      assert.equal(r.ok, c.ok, JSON.stringify(r.errors));
      if (!c.ok) assert.deepEqual(r.errors, c.errors);
      else if (c.config) {
        const out = mergeWith(schema, current, c.patch);
        for (const [k, v] of Object.entries(c.config)) assert.deepEqual(out[k], v, k);
      }
    });
  }
}

test("the shared file has merge cases for both sections", () => {
  for (const s of Object.keys(SECTIONS)) assert.ok(cases[s].cases.filter((c) => c.op === "merge").length >= 10, s);
});

test("KEYS and PAGE_KEYS come from the schema, in 1.2.0's order", () => {
  assert.deepEqual(KEYS, SCHEMA.map((f) => f.name));
  assert.deepEqual(PAGE_KEYS, ["face", "clock", "date", "weather", "moon", "stock", "github"]);
});

test("mergeWith keeps the schema's key order and fills record defaults", () => {
  const out = mergeWith(DEMO, cases.demo.defaults, { coins: [{ pair: "SOL-EUR" }], theme: 3 });
  assert.deepEqual(Object.keys(out), ["theme", "flags", "night", "names", "coins"]);
  assert.deepEqual(out.coins, [{ pair: "SOL-EUR", style: "coinbase" }]);
});

test("knownWith drops unknown keys, unknown group fields and unknown record fields", () => {
  const out = knownWith(DEMO, { later: 1, flags: { a: true, z: 1 }, coins: [{ pair: "A-B", extra: 2 }] });
  assert.deepEqual(out, { flags: { a: true }, coins: [{ pair: "A-B" }] });
});

test("a group check without a current value runs only when the patch has every field", () => {
  assert.equal(validateWith(DEMO, { night: { start: 7 } }).ok, true);
  assert.equal(validateWith(DEMO, { night: { enabled: true, start: 7, end: 7, brightness: 9 } }).ok, false);
});

test("mergeWith skips null group fields and null record fields", () => {
  const out = mergeWith(DEMO, cases.demo.defaults, { night: { start: null, end: 9 }, coins: [{ pair: "A-B", style: null }] });
  assert.equal(out.night.start, cases.demo.defaults.night.start);
  assert.equal(out.night.end, 9);
  assert.deepEqual(out.coins, [{ pair: "A-B", style: "coinbase" }]);
});
