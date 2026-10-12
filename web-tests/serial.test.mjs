import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BuddyPort, NoReply, ESPRESSIF_VID, BUDDY_PID } from "../web/js/serial.js";

// A Web Serial port that never answers. With stall, writes never complete,
// like a Buddy that doesn't read USB (boot loop, or Chrome's 255-byte buffer full).
function fakePort({ vid = ESPRESSIF_VID, pid = BUDDY_PID, stall = false } = {}) {
  return {
    readable: null,
    writable: null,
    closed: false,
    getInfo() { return { usbVendorId: vid, usbProductId: pid }; },
    async open() {
      this.readable = new ReadableStream();
      this.writable = new WritableStream({ write: () => (stall ? new Promise(() => {}) : undefined) });
    },
    async setSignals() {},
    async close() { this.readable = this.writable = null; this.closed = true; },
  };
}

function setPorts(ports) {
  Object.defineProperty(globalThis.navigator, "serial", {
    value: { getPorts: async () => ports }, configurable: true,
  });
}

const within = (ms, promise, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms)),
]);

// ── E: a Buddy that doesn't read must not hang the page ───

test("a write the Buddy never takes ends in NoReply, and the port counts as lost", async () => {
  const bp = new BuddyPort(fakePort({ stall: true }));
  bp.writeWaitMs = 100;
  await bp.open();
  await within(2000, assert.rejects(bp.command("INFO", null, { attempts: 1, wait: 100 }), NoReply), "INFO");
  assert.equal(bp.lost, true);
});

test("close() finishes even with a write stuck in the port", async () => {
  const port = fakePort({ stall: true });
  const bp = new BuddyPort(port);
  bp.writeWaitMs = 100;
  await bp.open();
  await assert.rejects(bp.command("INFO", null, { attempts: 1, wait: 100 }), NoReply);
  await within(5000, bp.close(), "close()");
  assert.equal(port.closed, true);
  assert.equal(bp.isOpen, false);
});

test("a Buddy that reads still gets the normal reply timeout", async () => {
  const bp = new BuddyPort(fakePort());
  bp.writeWaitMs = 100;
  await bp.open();
  await assert.rejects(bp.command("INFO", null, { attempts: 1, wait: 300 }), /no reply to INFO/);
  assert.equal(bp.lost, false);
  await bp.close();
});

// ── C: after a USB drop, flash through the port as it is now ─

test("refind() picks the port the Buddy came back as", async () => {
  const old = fakePort();
  const back = fakePort();
  const bp = new BuddyPort(old);
  setPorts([fakePort({ vid: 0x1234 }), back]); // the old handle is gone
  assert.equal(await bp.refind(), back);
  assert.equal(bp.port, back);
});

test("refind() keeps the current port while it is still there", async () => {
  const cur = fakePort();
  const bp = new BuddyPort(cur);
  setPorts([fakePort(), cur]);
  assert.equal(await bp.refind(), cur);
});

test("the app flashes through refind(), never through the stored handle", () => {
  const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
  const calls = [...app.matchAll(/dev\.flashImage\(\s*([\w.]+)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ["port"]);
  assert.match(app, /const port = await app\.bp\.refind\(\);\s[\s\S]{0,200}dev\.flashImage\(port,/);
});

test("refind() keeps the current port when no Buddy is listed", async () => {
  const cur = fakePort();
  const bp = new BuddyPort(cur);
  setPorts([fakePort({ vid: 0x1234 })]);
  assert.equal(await bp.refind(), cur);
  setPorts([]);
  assert.equal(await bp.refind(), cur);
});

