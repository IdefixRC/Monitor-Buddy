import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { S } from "../web/js/strings.js";

test("strings load and have the start texts", () => {
  assert.equal(typeof S.connect, "string");
  assert.ok(S.unsupported.length > 20);
});

test("vendored zones table is the pinned one", () => {
  const zones = JSON.parse(readFileSync(new URL("../web/vendor/posix_tz_db/zones.json", import.meta.url)));
  assert.equal(Object.keys(zones).length, 461);
  assert.equal(zones["Europe/Berlin"], "CET-1CEST,M3.5.0,M10.5.0/3");
});
