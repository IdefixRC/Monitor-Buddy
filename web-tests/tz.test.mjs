import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ruleForZone, ruleFromOffset, ruleUpdate } from "../web/js/tz.js";

const table = { "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3", "Asia/Singapore": "<+08>-8" };

test("zone lookup", () => {
  assert.equal(ruleForZone(table, "Europe/Berlin"), "CET-1CEST,M3.5.0,M10.5.0/3");
  assert.equal(ruleForZone(table, "Mars/Olympus"), null);
});

test("a saved rule that differs from the table gets an offer", () => {
  assert.equal(ruleUpdate(table, "Europe/Berlin", "CET-1"), table["Europe/Berlin"]);
  assert.equal(ruleUpdate(table, "Europe/Berlin", table["Europe/Berlin"]), null);
  assert.equal(ruleUpdate(table, "Mars/Olympus", "CET-1"), null);
  assert.equal(ruleUpdate(table, "Europe/Berlin", ""), null);
});

test("the table has the 2026 changes", () => {
  const zones = JSON.parse(readFileSync(new URL("../web/vendor/posix_tz_db/zones.json", import.meta.url), "utf8"));
  assert.equal(zones["America/Edmonton"], "CST6");
  assert.equal(zones["America/Vancouver"], "MST7");
  assert.equal(zones["America/Winnipeg"], "EST5");
  assert.equal(zones["America/Havana"], "CDT4");
  assert.equal(Object.keys(zones).length, 461);
});

test("fixed offsets match the firmware", () => {
  assert.equal(ruleFromOffset(8), "<+08>-8");
  assert.equal(ruleFromOffset(-5), "<-05>5");
  assert.equal(ruleFromOffset(5.5), "<+0530>-5:30");
  assert.equal(ruleFromOffset(5.75), "<+0545>-5:45");
  assert.equal(ruleFromOffset(-3.5), "<-0330>3:30");
  assert.equal(ruleFromOffset(0), "UTC0");
  assert.equal(ruleFromOffset(15), null);
  assert.equal(ruleFromOffset(-13), null);
  assert.equal(ruleFromOffset(NaN), null);
});
