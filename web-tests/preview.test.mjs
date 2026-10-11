import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, themeColors, pageList, textPath, textWidth, moonPhase, moonLabel } from "../web/js/preview.js";

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
