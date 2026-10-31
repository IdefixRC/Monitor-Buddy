// Backwards compatibility on the flasher side (spec §7: C4, C5, C6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBackup, validateConfig, mergeConfig, BASELINE_PATHS, filterSupported, unsupportedKeys } from "../web/js/settings.js";
import { DEFAULTS, newFormState, offered } from "../web/js/form.js";
import { parseConfigH } from "../web/js/configh.js";

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const backup = JSON.parse(fixture("backup-1.2.0.json"));

test("C4: a 1.2.0 backup imports exactly as today", () => {
  const cfg = readBackup(backup);
  assert.deepEqual(cfg, backup.config);
  assert.equal(validateConfig(cfg).ok, true);
  assert.deepEqual(mergeConfig(DEFAULTS, cfg), backup.config);
});

test("C5: importing to a board without a key leaves only that key out", () => {
  const supported = new Set(BASELINE_PATHS.filter((p) => p !== "wind_unit"));
  const cfg = readBackup(backup);
  assert.deepEqual(unsupportedKeys(cfg, supported), ["wind_unit"]);
  const kept = filterSupported(cfg, supported);
  assert.equal(Object.hasOwn(kept, "wind_unit"), false);
  assert.equal(kept.ticker, "AVGO");
});

test("C6: with no GET (path B) the form offers 1.2.0's full set", () => {
  const f = newFormState(DEFAULTS, { flow: "upgrade" });
  for (const p of BASELINE_PATHS) assert.equal(offered(f, p), true, p);
});

test("C6: a 1.1 config.h still imports to a valid config", () => {
  const table = { "Asia/Singapore": "<+08>-8" };
  const { config } = parseConfigH(fixture("config.h.v1.1.0"), table);
  assert.equal(validateConfig(config).ok, true);
});
