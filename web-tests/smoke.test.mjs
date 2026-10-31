import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

test("every S.… text the app uses exists", () => {
  const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
  const paths = new Set([...app.matchAll(/\bS\.([A-Za-z]\w*(?:\.[A-Za-z]\w*)*)/g)].map((m) => m[1]));
  assert.ok(paths.size > 50, "found the app's texts");
  const missing = [...paths].filter((p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), S) === undefined);
  assert.deepEqual(missing, []);
});

// ── Accessibility follow-ups from the GUI review (2026-10-13) ─

test("the phone strip hides the page name from sight, not from screen readers", () => {
  const css = readFileSync(new URL("../web/css/app.css", import.meta.url), "utf8");
  const rule = css.match(/\.buddy-preview--compact \.buddy-preview__caption \{([^}]*)\}/);
  assert.ok(rule, "the compact caption rule exists");
  assert.doesNotMatch(rule[1], /display:\s*none|visibility:\s*hidden/);
  assert.match(rule[1], /clip:\s*rect\(0 0 0 0\)/);
});

test("the form's error alert stays in the page instead of being un-hidden", () => {
  const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
  assert.match(app, /h\("div", \{ class: "form-summary", role: "alert" \}\)/);
  assert.doesNotMatch(app, /summary\.hidden\s*=/);
});

test("leaving the form drops the strip's scroll padding", () => {
  const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
  assert.match(app, /removeProperty\("--strip-h"\)/);
});

test("every web/js module parses as an ES module", () => {
  const dir = new URL("../web/js/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 10, "found the modules");
  for (const f of files) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: readFileSync(new URL(f, dir)) });
    assert.equal(r.status, 0, `${f}: ${String(r.stderr).split("\n").slice(0, 5).join("\n")}`);
  }
});
