import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBoard, BUDDY_CHIP, SDA, SCL } from "../web/js/boardcheck.js";
import { board, OUT, EN, EN_W1TS, outSel, mux, OUT_INV } from "./i2c-sim.mjs";

test("a Buddy board passes: the motion sensor says 0x05 and the touch controller answers", async () => {
  const b = board({ devices: ["imu", "touch"] });
  const r = await checkBoard(b);
  assert.equal(r.ok, true, r.detail);
  assert.equal(b.droveHigh, false, "a line was driven high");
});

test("no devices on the bus: not a Buddy", async () => {
  const r = await checkBoard(board({ devices: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.why, "imu");
});

test("a sensor at 0x6B with another ID: not a Buddy", async () => {
  const r = await checkBoard(board({ devices: ["imu", "touch"], imuId: 0x68 }));
  assert.equal(r.ok, false);
  assert.equal(r.why, "imu");
});

test("the motion sensor without the touch controller: not a Buddy", async () => {
  const r = await checkBoard(board({ devices: ["imu"] }));
  assert.equal(r.ok, false);
  assert.equal(r.why, "touch");
});

test("no pull-ups on the lines: it stops without pulling anything low", async () => {
  // COM6, 2026-10-17: SDA read 0 with the internal pull-ups off.
  const b = board({ devices: [], pullups: false, floating: 0 });
  let pulled = false;
  const write = b.write;
  b.write = async (addr, value) => {
    if (addr === EN_W1TS) pulled = true;
    return write(addr, value);
  };
  const r = await checkBoard(b);
  assert.equal(r.ok, false);
  assert.equal(r.why, "pullups");
  assert.equal(pulled, false, "a line was pulled low");
});

test("it never drives a line high, even on a board that answers", async () => {
  const b = board({ devices: ["imu", "touch"] });
  await checkBoard(b);
  assert.equal(b.droveHigh, false);
  assert.equal(b.get(outSel(SDA)) & OUT_INV, 0);
  assert.equal(b.get(outSel(SCL)) & OUT_INV, 0);
});

test("the pins are left exactly as they were found", async () => {
  for (const devices of [["imu", "touch"], []]) {
    const b = board({ devices });
    b.regs.set(mux(SDA), 0x1234b00);
    b.regs.set(outSel(SCL), 0x81);
    b.regs.set(OUT, (1 << SCL) | 1);
    b.regs.set(EN, 1 << 3);
    const before = new Map(b.regs);
    await checkBoard(b);
    for (const [addr, value] of before) {
      assert.equal(b.get(addr) >>> 0, value >>> 0, `register 0x${addr.toString(16)} changed`);
    }
  }
});

test("a failed register read ends the check with that error", async () => {
  const b = board({ devices: ["imu", "touch"] });
  b.read = async () => { throw new Error("Timeout"); };
  await assert.rejects(checkBoard(b), /Timeout/);
});

test("the Buddy's chip is the ESP32-C6, as esptool-js names it", () => {
  assert.equal(BUDDY_CHIP, "ESP32-C6");
});
