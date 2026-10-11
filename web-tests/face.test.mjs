import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BITMAPS, bitmapPath, eyeTargets, eyelidPoints, springStep, SPRING, MOODS } from "../web/js/face.js";

const main = readFileSync(new URL("../src/main.cpp", import.meta.url), "utf8");

test("spring constants are the firmware's Eye struct values", () => {
  assert.deepEqual(SPRING, { k: 0.12, d: 0.60, pk: 0.08, pd: 0.50 });
  for (const [name, v] of [["k ", "0.12f"], ["d ", "0.60f"], ["pk", "0.08f"], ["pd", "0.50f"]]) {
    assert.match(main, new RegExp(`float ${name}\\s*= ${v.replace(".", "\\.")}`));
  }
});

test("bitmaps match the firmware's PROGMEM arrays", () => {
  for (const [key, cName] of [["heart", "bmp_heart"], ["zzz", "bmp_zzz"], ["anger", "bmp_anger"], ["github", "bmp_github"]]) {
    const start = main.indexOf(`${cName}[] PROGMEM`);
    const body = main.slice(start, main.indexOf("};", start));
    const hex = [...body.matchAll(/0x([0-9a-f]{2})/gi)].map((m) => m[1].toLowerCase()).join("");
    assert.equal(BITMAPS[key].hex, hex, key);
    assert.equal(hex.length / 2, Math.ceil(BITMAPS[key].w / 8) * BITMAPS[key].h, key);
  }
});

test("bitmapPath merges runs into one rectangle each", () => {
  // One row 0b01100000: a single run of two pixels starting at column 1.
  assert.equal(bitmapPath({ w: 8, h: 1, hex: "60" }), "M1 0h2v1h-2z");
  assert.equal(bitmapPath({ w: 8, h: 1, hex: "00" }), "");
});

test("springStep moves towards the target and settles", () => {
  const s = { v: 0, t: 100, vel: 0 };
  springStep(s, 0.12, 0.6);
  assert.ok(Math.abs(s.v - 7.2) < 1e-9);
  for (let i = 0; i < 200; i++) springStep(s, 0.12, 0.6);
  assert.ok(Math.abs(s.v - 100) < 1e-6);
});

test("mood eye sizes follow updateFacePhysics", () => {
  assert.deepEqual(eyeTargets("normal", 0, false).left, { w: 90, h: 90, dpx: 0, dpy: 0 });
  assert.equal(eyeTargets("normal", 3.5, false).left.h, 93.5);           // breathing
  assert.deepEqual(eyeTargets("happy", 0, false).right, { w: 92, h: 92, dpx: 0, dpy: -6 });
  assert.equal(eyeTargets("love", 0, false).left.w, 96);
  assert.equal(eyeTargets("excited", 0, false).left.h, 106);
  assert.equal(eyeTargets("sad", 0, false).left.h, 100);
  const sus = eyeTargets("suspicious", 0, false);
  assert.equal(sus.left.h, 50);
  assert.equal(sus.right.h, 105);
  assert.deepEqual(eyeTargets("love", 0, true).left, { w: null, h: 4, dpx: 0, dpy: 0 }); // blink
  for (const m of MOODS) assert.ok(eyeTargets(m, 0, false).left.w > 0, m);
});

test("eyelids: none for normal, a slanted band for sad, a squint for suspicious", () => {
  assert.equal(eyelidPoints("normal", 60, 35, 90, 90, true), "");
  assert.equal(eyelidPoints("happy", 60, 35, 90, 90, true), "");
  const pts = (s) => s.split(" ").map((p) => p.split(",").map(Number));
  // Sad, left eye: the band is higher on the outer (left) side by 0.167 * width.
  const sad = pts(eyelidPoints("sad", 60, 35, 90, 90, true));
  assert.ok(Math.abs((sad[1][1] - sad[0][1]) - 90 * 0.167) < 0.01);
  assert.ok(Math.abs((sad[3][1] - sad[0][1]) - 90 * 0.44) < 0.01);
  // Suspicious: the left lid covers the top half less 5; the right has a lower lid.
  const left = pts(eyelidPoints("suspicious", 60, 55, 90, 50, true));
  assert.equal(left[2][1], 55 + 50 / 2 - 5);
  const right = pts(eyelidPoints("suspicious", 60, 27, 90, 105, false));
  assert.ok(Math.abs(right[0][1] - (27 + 105 - 105 * 0.22)) < 0.01);
});
