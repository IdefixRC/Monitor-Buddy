import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, themeColors, pageList, textPath, textWidth, moonPhase, moonLabel, PageCycle, HOLD_MS, CYCLE_MS } from "../web/js/preview.js";
import { previewPageFor } from "../web/js/form.js";

const main = readFileSync(new URL("../src/main.cpp", import.meta.url), "utf8");
const all = { face: true, clock: true, date: true, weather: true, moon: true, stock: true, github: true };

test("page list mirrors buildPageList", () => {
  const c = { github_user: "octocat", stock_key: "k", pages: all };
  assert.deepEqual(pageList(c), ["face", "clock", "date", "weather", "moon", "stock", "github"]);
  assert.deepEqual(pageList({ ...c, stock_key: "" }), ["face", "clock", "date", "weather", "moon", "github"]);
  assert.deepEqual(pageList({ ...c, github_user: "" }), ["face", "clock", "date", "weather", "moon", "stock"]);
  assert.deepEqual(pageList({ ...c, pages: { clock: true, moon: true } }), ["clock", "moon"]);
  // Nothing left: the face, so the screen is never blank.
  assert.deepEqual(pageList({ github_user: "", stock_key: "", pages: { stock: true, github: true } }), ["face"]);
  assert.deepEqual(pageList({ pages: {} }), ["face"]);
  assert.deepEqual(pageList(undefined), ["face"]);
});

test("five themes; Classic is all white; out-of-range falls back to Classic", () => {
  assert.equal(THEMES.length, 5);
  assert.ok(Object.values(THEMES[0]).every((v) => v === "#ffffff"));
  assert.equal(themeColors(9), THEMES[0]);
  assert.equal(themeColors(2), THEMES[2]);
});

test("theme colours are the 8-bit values written in applyTheme", () => {
  const hex = (r, g, b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  const start = main.indexOf("void applyTheme() {");
  const body = main.slice(start, main.indexOf("float clampFloat", start));
  const used = new Set([...body.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => hex(+m[1], +m[2], +m[3])));
  const ours = new Set(THEMES.flatMap((t) => Object.values(t)).filter((v) => v !== "#ffffff"));
  assert.deepEqual([...ours].sort(), [...used].sort());
  assert.equal(THEMES[2].priceDown, "#ff505a");
  assert.equal(THEMES[3].time, "#ffb428");
  assert.equal(THEMES[4].sec, "#3cc8c8");
  assert.equal(THEMES[1].time, "#ffffff");
});

test("pixel text advances 6 px per character times the size", () => {
  assert.equal(textWidth("AVGO", 4), 96);
  assert.equal(textPath(" ", 0, 0, 2), "");
  // "-" is one 5-pixel run on row 3.
  assert.equal(textPath("-", 10, 20, 2), "M10 26h10v2h-10z");
  assert.equal(textPath("—", 10, 20, 2), textPath("-", 10, 20, 2));
});

test("moon phase uses drawMoon's epoch and synodic month", () => {
  // 2000-01-06 18:14 UTC was a new moon; drawMoon's reference is close to it.
  const m = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14) + new Date(2000, 0, 6).getTimezoneOffset() * 60000));
  assert.ok(m.age < 0.5 || m.age > 29, `age ${m.age}`);
  assert.equal(moonLabel(m.phase), "NEW MOON");
  assert.equal(moonLabel(0.5), "FULL MOON");
  assert.equal(moonLabel(0.25), "FIRST QUARTER");
});

// ── The page cycle and the hold after a change (GUI review, 2026-10-12) ──

function cycleWith(pages, opts = {}) {
  const seen = [];
  const c = new PageCycle({ onChange: () => seen.push(c.page), ...opts });
  c.setPages(pages);
  return { c, seen };
}
const timers = (t) => { mock.timers.enable({ apis: ["setInterval", "setTimeout"] }); t.after(() => mock.timers.reset()); };

test("the cycle advances every CYCLE_MS", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather"]);
  assert.equal(c.page, "face");
  mock.timers.tick(CYCLE_MS);
  assert.equal(c.page, "clock");
  mock.timers.tick(CYCLE_MS);
  assert.equal(c.page, "weather");
});

test("showPage jumps, holds for HOLD_MS, then the cycle resumes", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather", "stock"]);
  assert.equal(HOLD_MS >= 5000, true);
  assert.equal(c.showPage("weather"), true);
  assert.equal(c.page, "weather");
  mock.timers.tick(HOLD_MS - 1);
  assert.equal(c.page, "weather", "still held");
  mock.timers.tick(1); // the hold ends and the cycle restarts (mock timers: a timer set during tick() waits for the next tick)
  mock.timers.tick(CYCLE_MS);
  assert.equal(c.page, "stock", "cycling again after the hold");
});

test("a further change restarts the hold, and jumps if it belongs elsewhere", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather"]);
  c.showPage("weather");
  mock.timers.tick(4000);
  c.showPage("clock");
  assert.equal(c.page, "clock");
  mock.timers.tick(4000);
  assert.equal(c.page, "clock", "the hold restarted at the second change");
  c.showPage(null); // theme: no jump, hold again
  mock.timers.tick(HOLD_MS - 1);
  assert.equal(c.page, "clock");
  mock.timers.tick(1); // the hold ends and the cycle restarts (mock timers: a timer set during tick() waits for the next tick)
  mock.timers.tick(CYCLE_MS);
  assert.equal(c.page, "weather");
});

test("a page that is off or hidden is not shown, and nothing is held", (t) => {
  timers(t);
  const { c, seen } = cycleWith(["face", "clock"]);
  assert.equal(c.showPage("stock"), false);
  assert.deepEqual(seen, []);
  assert.equal(c.holding, false);
  mock.timers.tick(CYCLE_MS);
  assert.equal(c.page, "clock", "the cycle carried on");
});

test("paused: a jump still shows the page, and the cycle stays paused after the hold", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather"]);
  c.setPaused(true);
  c.showPage("weather");
  assert.equal(c.page, "weather");
  mock.timers.tick(HOLD_MS + CYCLE_MS * 3);
  assert.equal(c.page, "weather");
  assert.equal(c.cycling, false);
});

test("reduced motion: jumps work, there is never an automatic cycle", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather"], { reduced: () => true });
  assert.equal(c.cycling, false);
  c.showPage("clock");
  mock.timers.tick(HOLD_MS + CYCLE_MS * 3);
  assert.equal(c.page, "clock");
});

test("a click on the preview ends a hold and moves on", (t) => {
  timers(t);
  const { c } = cycleWith(["face", "clock", "weather"]);
  c.showPage("clock");
  c.next();
  assert.equal(c.page, "weather");
  assert.equal(c.holding, false);
  assert.equal(c.cycling, true);
});

test("which page a setting jumps to", () => {
  const cfg = { pages: { face: true, moon: true, stock: false } };
  for (const k of ["temp_unit", "wind_unit", "city", "lat", "lon"]) assert.equal(previewPageFor(k, cfg), "weather", k);
  for (const k of ["tz_name", "tz_rule"]) assert.equal(previewPageFor(k, cfg), "clock", k);
  for (const k of ["ticker", "stock_key"]) assert.equal(previewPageFor(k, cfg), "stock", k);
  assert.equal(previewPageFor("github_user", cfg), "github");
  assert.equal(previewPageFor("mount", cfg), "face");
  assert.equal(previewPageFor("theme", cfg), "stay");
  assert.equal(previewPageFor("pages.moon", cfg), "moon", "switched on");
  assert.equal(previewPageFor("pages.stock", cfg), null, "switched off");
  for (const k of ["wifi.ssid", "wifi.password", "wifi.configure", undefined]) assert.equal(previewPageFor(k, cfg), null, String(k));
});
