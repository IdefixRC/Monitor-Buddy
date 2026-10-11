// A Web Serial session with a Monitor Buddy, speaking the @MB protocol.
// Mirrors tools/mb_serial.py (command, read_reply, reconnect, drain, change,
// verify_change). Browser only: it needs navigator.serial.
import { CHANGING, LineSplitter, answers, makeIdSource, parseReply, requestLine } from "./protocol.js";

export const BAUD = 115200;
export const ESPRESSIF_VID = 0x303a;
export const BUDDY_PID = 0x1001; // the ESP32-C6's built-in USB-serial/JTAG
const CHANGE_WAIT_MS = 3000;
const READ_WAIT_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NoReply extends Error {
  constructor(message) {
    super(message);
    this.name = "NoReply";
  }
}

// One function on purpose: whether opening first and then lowering DTR/RTS
// keeps the board from resetting is what the hardware spike has to find out.
// Python opens with the signals already low (pyserial sets them before open);
// Web Serial can't, so this is the part to change if the board resets.
export async function openQuietly(port) {
  await port.open({ baudRate: BAUD });
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
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
    const i = this.waiters.findIndex((w) => answers(reply, w.cmd, w.id));
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
    if (reader) { try { await reader.cancel(); } catch { /* port already gone */ } }
    if (readDone) { try { await readDone; } catch { /* the loop reports its own errors */ } }
    if (writer) {
      try { await writer.close(); } catch { /* port already gone */ }
      try { writer.releaseLock(); } catch { /* already released */ }
    }
    if (wasOpen || this.port.readable || this.port.writable) {
      try { await this.port.close(); } catch { /* already closed, or the device is gone */ }
    }
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
        await writer.write(new TextEncoder().encode(line));
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

  // Discard input until the line has been silent for quietMs.
  async drain(quietMs = 500) {
    this.lastRx = Date.now();
    while (Date.now() - this.lastRx < quietMs) await sleep(50);
  }

  async _findPort() {
    const ports = (await navigator.serial.getPorts()).filter(isBuddy);
    return ports.includes(this.port) ? this.port : ports[0] || null;
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
      // setup() can block for ~18 s, and reopening the port on every miss could
      // reset the board each time (if open-then-lower-DTR/RTS resets it).
      try {
        const info = await this.command("INFO", null, { attempts: 1, wait: READ_WAIT_MS });
        if (info.ok !== false) {
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
    for (const [key, value] of Object.entries(want)) {
      if (key === "pages" && value && typeof value === "object") {
        for (const [page, on] of Object.entries(value)) {
          if ((have.pages || {})[page] !== on) {
            return { ok: false, detail: `pages.${page} is not ${on} on the board` };
          }
        }
      } else if (!same(value, have[key])) {
        return { ok: false, detail: `${key} is not the requested value on the board` };
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
