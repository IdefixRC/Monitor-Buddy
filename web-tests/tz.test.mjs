import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleForZone, ruleFromOffset } from "../web/js/tz.js";

const table = { "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3", "Asia/Singapore": "<+08>-8" };

test("zone lookup", () => {
  assert.equal(ruleForZone(table, "Europe/Berlin"), "CET-1CEST,M3.5.0,M10.5.0/3");
  assert.equal(ruleForZone(table, "Mars/Olympus"), null);
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
