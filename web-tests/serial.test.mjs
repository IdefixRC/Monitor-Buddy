import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BuddyPort, NoReply, ESPRESSIF_VID, BUDDY_PID, probe, PROBE_WRITES, verifyChange } from "../web/js/serial.js";

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

test("refind() picks the port the Buddy came back as, once its MAC is known", async () => {
  const old = fakePort();
  const back = fakePort();
  const bp = new BuddyPort(old);
  bp.mac = "b0:a6:04:8b:03:f0"; // the flash and reconnect() check it on the new port
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

// COM7, 2026-10-17: an ESP32-C3 in a boot loop dropped off USB every 1-3 s.
// In one of its gaps only COM12 (a Buddy) was listed, and the board check ran
// there. Without a MAC nothing can tell the two apart, so never switch.
test("refind() without a known MAC never switches to another port", async () => {
  const cur = fakePort();
  const bp = new BuddyPort(cur);
  setPorts([fakePort()]); // the picked board is in a USB gap; another board is listed
  assert.equal(await bp.refind(), cur);
});

test("refind() keeps the current port when no Buddy is listed", async () => {
  const cur = fakePort();
  const bp = new BuddyPort(cur);
  setPorts([fakePort({ vid: 0x1234 })]);
  assert.equal(await bp.refind(), cur);
  setPorts([]);
  assert.equal(await bp.refind(), cur);
});


// ── E3: at most two INFOs before the board proves it reads (2026-10-13) ──
// The C6's USB input buffer holds 64 bytes; an INFO line is about 27. A board
// that never reads USB (Waveshare's factory demo) keeps two, and a third
// would stick in the port, which Chrome then can't close until a replug.

const INFO_OK = { ok: true, cmd: "INFO", fw: "1.2.0" };

// A board for probe(): answer(n) is the reply to the n-th INFO written (or
// null for silence); late(n) is a reply that arrives while probe only listens.
function board({ answer = () => null, late = () => null } = {}) {
  return {
    isOpen: true, lost: false, writes: 0, listens: 0,
    async command(cmd) {
      this.writes++;
      await new Promise((r) => setTimeout(r, 5));
      const r = answer(this.writes);
      if (!r) throw new NoReply(`no reply to ${cmd}`);
      return r;
    },
    async waitForReply() {
      this.listens++;
      await new Promise((r) => setTimeout(r, 5));
      return late(this.listens);
    },
  };
}
const fast = { firstWaitMs: 5, waitMs: 5 };

test("a board that logs but never answers gets two INFOs, then path B", async () => {
  assert.equal(PROBE_WRITES, 2);
  const b = board();
  const rx = { last: Date.now(), status: false };
  const keepLogging = setInterval(() => { rx.last = Date.now(); }, 2);
  try {
    assert.equal(await probe(b, rx, { ...fast, maxMs: 120 }), null);
  } finally { clearInterval(keepLogging); }
  assert.equal(b.writes, 2);
  assert.ok(b.listens > 0, "it kept listening instead of writing");
});

test("a Buddy still in setup() is caught by its late answer", async () => {
  const b = board({ late: (n) => (n === 3 ? INFO_OK : null) });
  const rx = { last: Date.now(), status: false };
  assert.deepEqual(await probe(b, rx, { ...fast, maxMs: 2000 }), INFO_OK);
  assert.equal(b.writes, 2);
});

test("a Buddy that answers at once is found with one INFO", async () => {
  const b = board({ answer: () => INFO_OK });
  assert.deepEqual(await probe(b, { last: 0, status: false }, fast), INFO_OK);
  assert.equal(b.writes, 1);
});

test("an answer proves the board reads, so asking again is allowed", async () => {
  const restarting = { ok: false, cmd: "INFO", error: "restarting" };
  const b = board({ answer: (n) => (n < 4 ? restarting : INFO_OK) });
  assert.deepEqual(await probe(b, { last: Date.now(), status: false }, { ...fast, maxMs: 10000, pauseMs: 1 }), INFO_OK);
  assert.equal(b.writes, 4);
});

test("a 1.1 Buddy (status lines, no answer) goes to path B after one INFO", async () => {
  const b = board();
  assert.equal(await probe(b, { last: Date.now(), status: true }, fast), null);
  assert.equal(b.writes, 1);
});

test("a port that goes away ends the probe at once instead of spinning", async () => {
  const b = board();
  b.isOpen = false;
  await assert.rejects(probe(b, { last: Date.now(), status: false }, fast), /went away/);
  assert.equal(b.writes, 0);
});

test("waitForReply() takes a late answer to any INFO and sends nothing", async () => {
  const port = fakePort();
  const bp = new BuddyPort(port);
  await bp.open();
  const waiting = bp.waitForReply("INFO", 1000);
  bp._handleLine('@MB {"ok":true,"cmd":"INFO","id":12345,"fw":"1.2.0"}');
  assert.equal((await waiting).fw, "1.2.0");
  assert.equal(await bp.waitForReply("INFO", 20), null);
  await bp.close();
});

// ── Two Buddies on one computer (review, 2026-10-13) ──────
// Web Serial shows only VID/PID, the same for every Buddy, so the MAC decides.

test("refind() never guesses between two Buddies once the current one is gone", async () => {
  const cur = fakePort();
  const bp = new BuddyPort(cur);
  setPorts([fakePort(), fakePort()]);
  assert.equal(await bp.refind(), cur);
});

class StubPort extends BuddyPort {
  constructor(replies) { super(fakePort()); this.replies = replies; this.opens = 0; }
  async open() { this.isOpen = true; this.lost = false; this.opens++; }
  async close() { this.isOpen = false; }
  async command() { return this.replies.shift() || null; }
  async drain() {}
}

test("reconnect() refuses a different Buddy and waits for its own", async () => {
  setPorts([fakePort()]);
  const bp = new StubPort([
    { ok: true, cmd: "INFO", mac: "58:8c:81:5a:33:fc" },
    { ok: true, cmd: "INFO", mac: "b0:a6:04:8b:03:f0" },
  ]);
  bp.mac = "b0:a6:04:8b:03:f0";
  const info = await bp.reconnect(5000);
  assert.equal(info.mac, "b0:a6:04:8b:03:f0");
  assert.equal(bp.opens, 2, "it closed the wrong one and looked again");
});

test("reconnect() gives up rather than accept another Buddy", async () => {
  setPorts([fakePort()]);
  const other = { ok: true, cmd: "INFO", mac: "58:8c:81:5a:33:fc" };
  const bp = new StubPort(Array(20).fill(other));
  bp.mac = "b0:a6:04:8b:03:f0";
  await assert.rejects(bp.reconnect(1200), NoReply);
});

test("reconnect() learns the MAC when it didn't know it, on the port it has", async () => {
  const bp = new StubPort([{ ok: true, cmd: "INFO", mac: "b0:a6:04:8b:03:f0" }]);
  setPorts([bp.port]);
  await bp.reconnect(2000);
  assert.equal(bp.mac, "b0:a6:04:8b:03:f0");
});

test("reconnect() without a MAC doesn't take another board's port", async () => {
  setPorts([fakePort()]); // ours is gone; only another board is listed
  const bp = new StubPort(Array(20).fill({ ok: true, cmd: "INFO", mac: "58:8c:81:5a:33:fc" }));
  await assert.rejects(bp.reconnect(1200), NoReply);
  assert.equal(bp.opens, 0);
});

// ── verifyChange after a lost SET reply: paths, not keys ──

const boardWith = (config) => ({ command: async (cmd) => ({ ok: true, cmd, config }) });

test("verifyChange checks group fields one by one, in 1.2.0's wording", async () => {
  const bp = boardWith({ theme: 2, pages: { moon: false, face: true } });
  assert.equal((await verifyChange(bp, "SET", { config: { pages: { moon: false } } })).ok, true);
  const r = await verifyChange(bp, "SET", { config: { pages: { moon: true } } });
  assert.deepEqual(r, { ok: false, detail: "pages.moon is not true on the board" });
  const t = await verifyChange(bp, "SET", { config: { theme: 3 } });
  assert.deepEqual(t, { ok: false, detail: "theme is not the requested value on the board" });
});

test("verifyChange compares a list whole", async () => {
  const bp = boardWith({ later: ["A", "B"] });
  assert.equal((await verifyChange(bp, "SET", { config: { later: ["A", "B"] } })).ok, true);
  assert.deepEqual(await verifyChange(bp, "SET", { config: { later: ["A"] } }),
    { ok: false, detail: "later is not the requested value on the board" });
});
