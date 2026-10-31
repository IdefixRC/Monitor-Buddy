// A Web Serial session with a Monitor Buddy, speaking the @MB protocol.
// Mirrors tools/mb_serial.py (command, read_reply, reconnect, drain, change,
// verify_change). Browser only: it needs navigator.serial.
import { flattenPaths } from "./settings.js";
import { CHANGING, LineSplitter, answers, makeIdSource, parseReply, requestLine, sameMac } from "./protocol.js";

export const BAUD = 115200;
export const ESPRESSIF_VID = 0x303a;
export const BUDDY_PID = 0x1001; // the ESP32-C6's built-in USB-serial/JTAG
const CHANGE_WAIT_MS = 3000;
const READ_WAIT_MS = 1500;
// A Buddy running the firmware takes a write at once. One that doesn't read
// USB (boot loop after a cut-off flash) never does: Chrome's 255-byte buffer
// fills and write() never resolves (2026-10-12, COM12). Past this, give up.
const WRITE_WAIT_MS = 2000;
// close() must finish even then: a stuck write blocks writer.close() and abort().
const CLOSE_STEP_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Resolves true when `promise` settles within ms, false when it doesn't.
const settles = (promise, ms) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => true, () => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
  ]).finally(() => clearTimeout(timer));
};

export class NoReply extends Error {
  constructor(message) {
    super(message);
    this.name = "NoReply";
  }
}

export async function openQuietly(port) {
  // Chrome opens with DTR and RTS asserted. Lowering both in one setSignals()
  // call resets the ESP32-C6 (rst:0x15): the chip briefly sees RTS on, DTR off.
  // RTS first, then DTR, never passes through that state. Closing with the
  // lines already low doesn't reset either; closing with them still on does.
  // Measured on the Buddy in Chrome, 2026-10-11.
  await port.open({ baudRate: BAUD });
  await port.setSignals({ requestToSend: false });
  await port.setSignals({ dataTerminalReady: false });
}

function isBuddy(port) {
  const info = port.getInfo();
  return info.usbVendorId === ESPRESSIF_VID && info.usbProductId === BUDDY_PID;
}

export class BuddyPort {
  constructor(port) {
    this.port = port;
    this.reader = null;
    this.writer = null;
    this.readDone = null;
    this.waiters = [];
    this.listeners = [];
    this.errorListeners = [];
    this.nextId = makeIdSource();
    this.lastRx = Date.now();
    this.isOpen = false;
    this.lost = false; // the reader ended or failed while open: the device is gone
    this.stalled = false; // a write never completed: the Buddy isn't reading
    this.writeWaitMs = WRITE_WAIT_MS;
    this.mac = ""; // the board's MAC from INFO: reconnect() and the flash accept only this one
  }

  static supported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  static async pick() {
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VID }] });
    return new BuddyPort(port);
  }

  // fn(line, dir): every line the Buddy prints (dir "rx") and every request we send (dir "tx").
  onLine(fn) { this.listeners.push(fn); }
  // fn(error): the reader failed, usually because the cable was pulled.
  onError(fn) { this.errorListeners.push(fn); }

  _emit(line, dir) {
    for (const fn of this.listeners) {
      try { fn(line, dir); } catch { /* a listener must not break the reader */ }
    }
  }

  async open() {
    if (this.isOpen) return;
    try {
      await openQuietly(this.port);
    } catch (e) {
      try { await this.port.close(); } catch { /* it may not have opened */ }
      throw e;
    }
    this.isOpen = true;
    this.lost = false;
    this.stalled = false;
    this.lastRx = Date.now();
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.readDone = this._readLoop(this.reader);
  }

  async _readLoop(reader) {
    const decoder = new TextDecoder("utf-8");
    const splitter = new LineSplitter();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        this.lastRx = Date.now();
        for (const line of splitter.push(decoder.decode(value, { stream: true }))) this._handleLine(line);
      }
    } catch (e) {
      if (this.isOpen && this.reader === reader) {
        this.lost = true;
        for (const fn of this.errorListeners) { try { fn(e); } catch { /* ignore */ } }
      }
    } finally {
      if (this.isOpen && this.reader === reader) this.lost = true; // ended without close()
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  _handleLine(line) {
    this._emit(line, "rx");
    const reply = parseReply(line);
    if (!reply) return;
    const i = this.waiters.findIndex((w) => (w.any ? reply.cmd === w.cmd : answers(reply, w.cmd, w.id)));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      w.resolve(reply);
    }
  }

  // Safe to call twice. Cancels the reader, closes the writer, closes the port.
  async close() {
    const wasOpen = this.isOpen;
    this.isOpen = false;
    const reader = this.reader;
    const writer = this.writer;
    const readDone = this.readDone;
    this.reader = this.writer = this.readDone = null;
    // Settle pending commands so they end now with NoReply instead of at their timeout.
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.resolve(null);
    // Each step is bounded: with a write stuck in the port (stalled), close()
    // and even abort() can wait forever, and the page would hang with them.
    // Errors mean the port is already gone; the read loop reports its own.
    const step = (fn) => settles(Promise.resolve().then(fn), CLOSE_STEP_MS);
    const stalled = this.stalled;
    this.stalled = false;
    if (reader) await step(() => reader.cancel());
    if (readDone) await step(() => readDone);
    if (writer) {
      await step(() => (stalled ? writer.abort() : writer.close()));
      try { writer.releaseLock(); } catch { /* already released */ }
    }
    if (wasOpen || this.port.readable || this.port.writable) await step(() => this.port.close());
  }

  // The port as it is now. After a USB drop (a reset, BOOT/RESET, a cut-off
  // flash) Chrome hands out a new SerialPort and the old one never opens
  // again, so anything that opens the port itself (esptool-js) asks here
  // first. Keeps the current port when it is still listed or no Buddy is.
  async refind() {
    let port = null;
    try { port = await this._findPort(); } catch { /* keep the current one */ }
    if (port) this.port = port;
    return this.port;
  }

  // Sends `cmd` with a fresh id and resolves with the reply that echoes that id
  // and command word. Read-only commands are retried (3 x 1.5 s); SET, DEFAULTS
  // and REBOOT go out ONCE and get 3 s: the Buddy may have acted and lost only
  // its reply, and a second copy would hit a board that is restarting.
  // Throws NoReply; use change() to find out what happened to the board.
  async command(cmd, body = null, { attempts, wait } = {}) {
    if (!this.isOpen) throw new Error("the port is not open");
    const changing = CHANGING.includes(cmd);
    if (attempts === undefined) attempts = changing ? 1 : 3;
    if (wait === undefined) wait = changing ? CHANGE_WAIT_MS : READ_WAIT_MS;
    const id = this.nextId();
    const line = requestLine(cmd, id, body);
    let waiter;
    const replied = new Promise((resolve) => { waiter = { cmd, id, resolve }; });
    this.waiters.push(waiter);
    try {
      for (let i = 0; i < attempts; i++) {
        const writer = this.writer;
        if (!this.isOpen || !writer) throw new NoReply(`${cmd}: the port was closed`);
        this._emit(line.trimEnd(), "tx");
        if (!(await settles(writer.write(new TextEncoder().encode(line)), this.writeWaitMs))) {
          // The Buddy isn't reading: treat the port as lost, so callers reopen
          // it (reconnect) or give up (the probe falls through to path B).
          this.stalled = this.lost = true;
          throw new NoReply(`${cmd}: the Buddy isn't reading`);
        }
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), wait); });
        const reply = await Promise.race([replied, timeout]);
        clearTimeout(timer);
        if (reply) return reply;
        if (!this.isOpen || this.writer !== writer) throw new NoReply(`${cmd}: the port was closed`);
      }
    } finally {
      const i = this.waiters.indexOf(waiter);
      if (i >= 0) this.waiters.splice(i, 1);
    }
    throw new NoReply(`no reply to ${cmd}`);
  }

  // The next reply to `cmd`, whatever its id, or null after ms. Sends nothing:
  // it catches a late answer to a request already written (probe()).
  async waitForReply(cmd, ms) {
    if (!this.isOpen) return null;
    let waiter, timer;
    const replied = new Promise((resolve) => { waiter = { cmd, any: true, resolve }; });
    this.waiters.push(waiter);
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
    try {
      return await Promise.race([replied, timeout]);
    } finally {
      clearTimeout(timer);
      const i = this.waiters.indexOf(waiter);
      if (i >= 0) this.waiters.splice(i, 1);
    }
  }

  // Discard input until the line has been silent for quietMs.
  async drain(quietMs = 500) {
    this.lastRx = Date.now();
    while (Date.now() - this.lastRx < quietMs) await sleep(50);
  }

  // The current port while it is listed; otherwise, once the board's MAC is
  // known, the one Buddy that is. They all look alike (VID/PID), so it never
  // guesses between several (review, 2026-10-13), and never switches at all
  // without a MAC: with one board in a USB gap, the only one listed can be
  // another (COM7 and COM12, 2026-10-17). With a MAC, INFO (reconnect) and
  // esptool (WrongBoard) prove the switch before anything is written.
  async _findPort() {
    const ports = (await navigator.serial.getPorts()).filter(isBuddy);
    if (ports.includes(this.port)) return this.port;
    return this.mac && ports.length === 1 ? ports[0] : null;
  }

  // After a restart: reopen the device (it vanishes from USB for a moment and
  // may come back as a new SerialPort object) and wait until INFO answers.
  // setup() blocks for up to ~18 s. Resolves with the INFO reply.
  async reconnect(timeoutMs = 40000) {
    const end = Date.now() + timeoutMs;
    await this.close();
    while (Date.now() < end) {
      if (this.isOpen && this.lost) await this.close(); // the device vanished: find it again
      if (!this.isOpen) {
        let port = null;
        try { port = await this._findPort(); } catch { /* try again */ }
        if (!port) { await sleep(500); continue; }
        this.port = port;
        try {
          await this.open();
        } catch {
          await this.close();
          await sleep(500);
          continue;
        }
      }
      // Connected. Keep this connection and ask again until the deadline:
      // setup() can block for ~18 s, and reopening on every miss gains nothing
      // (openQuietly doesn't reset the board; measured 2026-10-11).
      try {
        const info = await this.command("INFO", null, { attempts: 1, wait: READ_WAIT_MS });
        if (info.ok !== false && this.mac && info.mac && !sameMac(info.mac, this.mac)) {
          // Another Buddy answered (its port came up first): not ours. Look again.
          await this.close();
          await sleep(500);
          continue;
        }
        if (info.ok !== false) {
          if (!this.mac && info.mac) this.mac = info.mac;
          // Earlier probes sat in the Buddy's RX buffer while setup() ran, so it
          // answers them in a burst right after. Drop those replies.
          await this.drain(500);
          return info;
        }
        await sleep(1000); // "restarting": still on its way
      } catch (e) {
        if (e instanceof NoReply && this.isOpen && !this.lost) continue; // just silent so far
        await this.close(); // write failed or the port went away: reopen
        await sleep(500);
      }
    }
    throw new NoReply("the Buddy did not come back");
  }
}

// At most this many INFO lines go out before the board has answered one
// (review, 2026-10-13). The C6's USB input buffer holds 64 bytes and an INFO
// line is about 27, so a board that never reads USB keeps two; a third would
// stick in the port, which Chrome then can't close until a replug. Waveshare's
// factory demo is such a board: its USB console is output only.
export const PROBE_WRITES = 2;
export const PROBE_MAX_MS = 25000;

// Asks INFO and tells a Buddy that answers from one that doesn't. Resolves
// the INFO reply, or null (no Buddy that speaks @MB: path B). rx is
// { last, status }: when the last line arrived, and whether a status line
// ("app=...") showed the main loop running. A Buddy that was just plugged in
// sits in setup() for up to ~18 s and answers nothing, so while boot lines
// keep coming the probe waits, listening for the late answer instead of
// writing more. Any answer proves the board reads, and then asking again is
// safe. Throws when the port goes away.
export async function probe(bp, rx, {
  onBooting = () => {}, maxMs = PROBE_MAX_MS, firstWaitMs = 1000, waitMs = 1500, pauseMs = 1000,
} = {}) {
  const start = Date.now();
  let told = false;
  let reads = false;
  let sent = 0;
  for (;;) {
    if (!bp.isOpen || bp.lost) throw new Error("the port went away");
    let r = null;
    if (reads || sent < PROBE_WRITES) {
      sent++;
      try {
        r = await bp.command("INFO", null, { attempts: 1, wait: sent === 1 ? firstWaitMs : waitMs });
      } catch (e) {
        if (!(e instanceof NoReply)) throw e;
      }
    } else {
      r = await bp.waitForReply("INFO", waitMs);
    }
    if (r && r.ok) return r;
    if (r) reads = true; // "restarting": a 1.2+ Buddy on its way
    const booting = !!r || (Date.now() - rx.last < 3000 && !rx.status);
    if (!booting || Date.now() - start > maxMs) return null;
    if (!told) { onBooting(); told = true; }
    if (r) await sleep(pauseMs);
  }
}

const same = (want, got) => want === got || (got != null && String(want) === String(got));

// GET or INFO as a reply with ok:true, or null. These only read, so a few tries
// are fine; the first may land in a restart window.
async function readOk(bp, cmd) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await bp.command(cmd);
      if (r.ok) return r;
    } catch {
      return null;
    }
    await sleep(1000);
  }
  return null;
}

// After a reply was lost: does the board show the change `cmd` asked for?
// Resolves { ok, detail }. Wi-Fi can't be checked by value (the password is
// write-only), so a SET with wifi is judged by INFO.wifi.ssid alone.
export async function verifyChange(bp, cmd, body) {
  if (cmd === "REBOOT") {
    // Reconnecting after the port went away (reconnect() got INFO) is the
    // evidence; there is nothing else to compare.
    return { ok: true, detail: "the Buddy answered again after the port was reopened" };
  }
  if (cmd === "DEFAULTS") {
    const got = await readOk(bp, "GET");
    if (!got) return { ok: false, detail: "GET did not answer" };
    if (got.stored === false) return { ok: true, detail: "the saved settings are gone (stored:false)" };
    return { ok: false, detail: "the saved settings are still there (stored:true)" };
  }
  // SET
  const want = (body && body.config) || {};
  if (Object.keys(want).length) {
    const got = await readOk(bp, "GET");
    if (!got) return { ok: false, detail: "GET did not answer" };
    const have = got.config || {};
    for (const [path, value] of flattenPaths(want)) {
      const [top, field] = path.split(".");
      const got = field === undefined ? have[top] : (have[top] || {})[field];
      const equal = value !== null && typeof value === "object"
        ? JSON.stringify(value) === JSON.stringify(got)
        : same(value, got);
      if (!equal) {
        return { ok: false, detail: typeof value === "boolean" && field !== undefined
          ? `${path} is not ${value} on the board`
          : `${path} is not the requested value on the board` };
      }
    }
  }
  const wifi = body && body.wifi;
  if (wifi && typeof wifi === "object") {
    const got = await readOk(bp, "INFO");
    if (!got) return { ok: false, detail: "INFO did not answer" };
    if ((got.wifi || {}).ssid !== wifi.ssid) {
      return { ok: false, detail: "the saved Wi-Fi name is not the requested one" };
    }
  }
  return { ok: true, detail: "every requested value is on the board" };
}

// The Buddy answered "restarting" without an id: a restart is already pending
// and our request was not read. That is not a confirmed result either way.
const isIdlessRestarting = (r) => r.ok === false && !("id" in r) && r.error === "restarting";

// Sends SET, DEFAULTS or REBOOT once. If the reply arrives, that is the answer.
// If not (or if it is an id-less "restarting"), the board may still have done
// it, so reopen the port and check (verifyChange) instead of resending.
// NEVER resends.
// Resolves { ok, reply, note, restarted }: reply is null when it was lost;
// restarted is true when bp is already a fresh connection.
// opts.waitRestart: after an ok reply, also wait for the restart and reconnect.
export async function change(bp, cmd, body = null, { waitRestart = false } = {}) {
  let reply = null;
  try {
    reply = await bp.command(cmd, body);
  } catch { /* NoReply, or the port went away: verify below */ }
  if (reply && !isIdlessRestarting(reply)) {
    if (reply.ok && waitRestart) {
      await sleep(1500); // the Buddy restarts 300 ms after its reply
      await bp.reconnect();
      return { ok: true, reply, note: "", restarted: true };
    }
    return { ok: !!reply.ok, reply, note: "", restarted: false };
  }
  // No usable reply. The board probably restarted 300 ms after answering.
  const why = reply ? `the Buddy said it was already restarting when ${cmd} arrived` : `no reply to ${cmd}`;
  await bp.close();
  await sleep(1500);
  try {
    await bp.reconnect();
  } catch {
    return { ok: false, reply: null, restarted: false,
             note: `${why} and the Buddy did not come back; check it with INFO` };
  }
  const { ok, detail } = await verifyChange(bp, cmd, body);
  if (ok) {
    return { ok: true, reply: null, restarted: true,
             note: `${why}, but the change is on the board (${detail})` };
  }
  return { ok: false, reply: null, restarted: true,
           note: `${why}, and it did not take effect (${detail})` };
}
