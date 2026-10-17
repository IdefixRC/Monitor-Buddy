import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkIsBuddy, NotABuddy } from "../web/js/flasher.js";
import { board } from "./i2c-sim.mjs";

// What checkIsBuddy() uses of an esptool-js ESPLoader after main().
const loader = (chip, b = board()) => ({
  chip: { CHIP_NAME: chip },
  readReg: (addr) => b.read(addr),
  writeReg: (addr, value) => b.write(addr, value),
});

test("another chip family is refused as 'chip', before any register is touched", async () => {
  const b = board({ devices: ["imu", "touch"] });
  await assert.rejects(checkIsBuddy(loader("ESP32-S3", b)), (e) => e instanceof NotABuddy && e.kind === "chip");
  assert.equal(b.ops, 0);
});

test("an ESP32-C6 without the touch screen and motion sensor is refused as 'parts'", async () => {
  await assert.rejects(checkIsBuddy(loader("ESP32-C6", board({ devices: [] }))),
    (e) => e instanceof NotABuddy && e.kind === "parts");
});

test("an ESP32-C6 with both parts passes", async () => {
  await checkIsBuddy(loader("ESP32-C6", board({ devices: ["imu", "touch"] })));
});

const source = readFileSync(new URL("../web/js/flasher.js", import.meta.url), "utf8");
const body = (name) => {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name}() not found`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
};

test("flashImage checks the board after connecting and before erasing or writing", () => {
  const f = body("flashImage");
  const at = (s) => { const i = f.indexOf(s); assert.ok(i >= 0, `${s} not found`); return i; };
  assert.ok(at("loader.main(") < at("checkIsBuddy(loader"));
  assert.ok(at("checkIsBuddy(loader") < at("loader.eraseFlash("));
  assert.ok(at("checkIsBuddy(loader") < at("loader.writeFlash("));
});

test("a refused board is restarted into its own firmware, not left in install mode", () => {
  for (const name of ["flashImage", "checkBuddy"]) {
    const f = body(name);
    assert.match(f, /e instanceof NotABuddy[\s\S]{0,80}\) await restartRefused\(/, name);
  }
  assert.match(source, /async function restartRefused\([^)]*\) \{[^}]*resetToFirmware\(/);
});

test("checkBuddy only looks: it never erases or writes", () => {
  const f = body("checkBuddy");
  assert.match(f, /checkIsBuddy\(loader/);
  assert.doesNotMatch(f, /eraseFlash|writeFlash/);
});

test("checkBuddy reports the chip's MAC, so path B can hold on to this board", () => {
  const f = body("checkBuddy");
  assert.match(f, /\bmac = await loader\.chip\.readMac\(loader\)/);
  assert.match(f, /return \{ mac \}/);
});
