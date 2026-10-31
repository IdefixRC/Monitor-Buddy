// A pretend Buddy for checking the screens without hardware. app.js loads it
// only when the page is opened with ?fake=a (a 1.2+ Buddy that answers),
// ?fake=b (one that doesn't), ?fake=c (an ESP32-C6 board without the Buddy's
// touch screen and motion sensor) or ?fake=d (another ESP32 chip). c and d
// answer nothing and are refused by the board check. It never touches navigator.serial.
//
// Extra switches, all optional:
//   cancel           the port picker is cancelled
//   busy             opening the port fails as if another program held it
//   boot             the Buddy prints boot lines for a few seconds before it answers
//   flashfail=connect|erase|write   the first flash fails at that stage
//   noreturn=SET|DEFAULTS   after that command the Buddy doesn't come back on the first reconnect
//   added=key,key    keys the new firmware reports in GET's "added"
//   lost=SET         the reply to SET is lost (change() then verifies)
//   seterror=key     SET refuses with an error on that key
//   nowifi           the board has no saved Wi-Fi
//   keys=1.2.0       the board knows only 1.2.0's settings (GET reports only those, SET skips the rest)
//   missing=a,b      the board lacks these paths until it is flashed (then it knows everything)
//   fw=1.1.9         the firmware version INFO reports (to see the update ribbon)
// A Wi-Fi password of "wrongpass" never connects.
import { NoReply } from "./serial.js";
import { FlashError, NotABuddy } from "./flasher.js";
import { DEFAULTS } from "./form.js";
import { BASELINE_PATHS, supportedPaths, filterSupported, mergeConfig, validateConfig, validateWifi } from "./settings.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function fakeDevice(params) {
  const kind = params.get("fake");
  const answers = !["b", "c", "d"].includes(kind);
  // What boardcheck.js would find: c lacks the parts, d isn't an ESP32-C6.
  const refusal = kind === "c" ? new NotABuddy("parts", "motion sensor at 0x6b: no answer")
    : kind === "d" ? new NotABuddy("chip", "the chip is ESP32-S3, not ESP32-C6") : null;
  const board = {
    answers,
    fw: answers ? params.get("fw") || "1.2.0-rc1" : null,
    cfg_v: 1,
    config: mergeConfig(DEFAULTS, { github_user: "octocat", tz_name: "Europe/Berlin", tz_rule: "CET-1CEST,M3.5.0,M10.5.0/3", lat: "48.1374", lon: "11.5755" }),
    stored: true,
    added: [],
    wifi: params.has("nowifi") ? { saved: false, ssid: "", password: "" } : { saved: true, ssid: "HomeNet", password: "secret123" },
    restarting: false,
    booting: params.has("boot"),
  };
  // The paths the firmware on the fake board knows (spec §5.3, C3, C6b).
  const everything = () => supportedPaths(DEFAULTS);
  const missing = (params.get("missing") || "").split(",").filter(Boolean);
  let knows = params.get("keys") === "1.2.0" ? new Set(BASELINE_PATHS) : everything();
  for (const p of missing) knows.delete(p);
  const failOnce = new Set(params.get("flashfail") ? [params.get("flashfail")] : []);
  const loseOnce = new Set(params.get("lost") ? [params.get("lost")] : []);
  const noReturn = new Set(params.get("noreturn") ? [params.get("noreturn")] : []);
  let stayAway = false;

  const info = () => ({
    ok: true, cmd: "INFO", fw: board.fw, cfg_v: board.cfg_v, mac: "b0:a6:04:00:00:01",
    wifi: {
      saved: board.wifi.saved, ssid: board.wifi.ssid,
      connected: board.wifi.saved && board.wifi.password !== "wrongpass",
      ...(board.wifi.saved && board.wifi.password !== "wrongpass" ? { rssi: -58 } : {}),
    },
  });

  class FakeBuddyPort {
    static supported() { return true; }
    static async pick() {
      await sleep(200);
      if (params.has("cancel")) throw new DOMException("No port selected by the user.", "NotFoundError");
      return new FakeBuddyPort();
    }
    constructor() {
      this.port = { fake: true };
      this.isOpen = false;
      this.lost = false;
      this.listeners = [];
      this.errorListeners = [];
    }
    onLine(fn) { this.listeners.push(fn); }
    onError(fn) { this.errorListeners.push(fn); }
    _emit(line, dir) { for (const fn of this.listeners) fn(line, dir); }
    async open() {
      if (this.isOpen) return;
      await sleep(150);
      if (params.has("busy")) throw new DOMException("Failed to open serial port.", "NetworkError");
      this.isOpen = true;
      if (board.booting) {
        board.booting = false;
        let n = 0;
        const t = setInterval(() => {
          this._emit(n === 0 ? `ESP32-C6 Monitor-Buddy ${board.fw} starting` : `[wifi] connecting (${n})`, "rx");
          if (++n > 6) { clearInterval(t); board.awake = true; }
        }, 700);
        board.awake = false;
      } else {
        board.awake = true;
      }
    }
    async close() { this.isOpen = false; }
    async refind() { return this.port; }
    // A late answer to an INFO already written (serial.js probe()).
    async waitForReply(cmd, ms) {
      await sleep(ms);
      if (!this.isOpen) return null;
      if (!board.answers || board.awake === false) {
        if (board.fw === null) this._emit("app=0 mood=0 wifi=up up=812s rst=1", "rx");
        return null;
      }
      const reply = { ...this._answer(cmd, null), id: 0 };
      this._emit(`@MB ${JSON.stringify(reply)}`, "rx");
      return reply;
    }
    async drain() { await sleep(100); }
    async command(cmd, body = null) {
      if (!this.isOpen) throw new Error("the port is not open");
      const id = Math.floor(Math.random() * 1e6);
      this._emit(`@MB ${cmd} ${JSON.stringify({ id, ...(body || {}) })}`, "tx");
      await sleep(120);
      const silent = !board.answers || board.awake === false;
      if (silent) {
        if (board.fw === null) this._emit("app=0 mood=0 wifi=up up=812s rst=1", "rx");
        await sleep(900);
        throw new NoReply(`no reply to ${cmd}`);
      }
      const reply = this._answer(cmd, body);
      this._emit(`@MB ${JSON.stringify({ ...reply, id })}`, "rx");
      if (loseOnce.has(cmd)) { loseOnce.delete(cmd); await sleep(3000); throw new NoReply(`no reply to ${cmd}`); }
      return { ...reply, id };
    }
    _answer(cmd, body) {
      if (board.restarting) return { ok: false, cmd, error: "restarting" };
      switch (cmd) {
        case "INFO": return info();
        case "GET":
          return { ok: true, cmd, v: board.cfg_v, stored: board.stored, config: filterSupported(board.config, knows), added: [...board.added] };
        case "SET": {
          if (noReturn.delete("SET")) stayAway = true;
          const patch = body.config ? filterSupported(body.config, knows) : null;
          const errors = {};
          if (params.get("seterror")) errors[params.get("seterror")] = "rejected by the fake Buddy";
          if (patch) Object.assign(errors, validateConfig(patch).errors);
          if (body.wifi) Object.assign(errors, validateWifi(body.wifi).errors);
          if (Object.keys(errors).length) return { ok: false, cmd, errors };
          if (patch) { board.config = mergeConfig(board.config, patch); board.stored = true; board.added = []; }
          if (body.wifi) board.wifi = { saved: true, ssid: body.wifi.ssid, password: body.wifi.password };
          this._restart();
          return { ok: true, cmd };
        }
        case "DEFAULTS":
          if (noReturn.delete("DEFAULTS")) stayAway = true;
          board.config = mergeConfig(DEFAULTS, {});
          board.stored = false;
          this._restart();
          return { ok: true, cmd };
        case "REBOOT":
          this._restart();
          return { ok: true, cmd };
        default:
          return { ok: false, cmd, error: "unknown command" };
      }
    }
    _restart() {
      board.restarting = true;
      setTimeout(() => { board.restarting = false; this.isOpen = false; this.lost = true; }, 300);
    }
    async reconnect(timeoutMs = 40000) {
      this.isOpen = false;
      await sleep(Math.min(2500, timeoutMs));
      if (!board.answers || stayAway) { stayAway = false; throw new NoReply("the Buddy did not come back"); }
      this.isOpen = true;
      this.lost = false;
      board.awake = true;
      this._emit(`ESP32-C6 Monitor-Buddy ${board.fw} starting`, "rx");
      return info();
    }
  }

  async function checkBuddy(_port, { log } = {}) {
    const say = (t) => { if (log) log(t); };
    say("Connecting...");
    await sleep(1500);
    if (refusal) { say(`Board check: ${refusal.message}`); throw new FlashError("connect", refusal); }
    say("Board check: motion sensor and touch controller found");
    say("Restarting the board");
    return { mac: "b0:a6:04:00:00:01" };
  }

  async function flashImage(_port, image, { erase = false, onProgress, onStage, log } = {}) {
    const say = (t) => { if (log) log(t); };
    onStage?.("connect");
    say("Connecting...");
    await sleep(900);
    if (failOnce.has("connect")) {
      failOnce.delete("connect");
      throw new FlashError("connect", new Error("Failed to connect with the device"));
    }
    if (refusal) { say(`Board check: ${refusal.message}`); throw new FlashError("connect", refusal); }
    say("Chip is ESP32-C6 (fake)");
    if (erase) {
      onStage?.("erase");
      say("Erasing flash (this may take a while)...");
      await sleep(2500);
      if (failOnce.has("erase")) {
        failOnce.delete("erase");
        board.wifi = { saved: false, ssid: "", password: "" };
        throw new FlashError("erase", new Error("Timed out waiting for packet header"));
      }
      board.config = mergeConfig(DEFAULTS, {});
      board.stored = false;
      board.wifi = { saved: false, ssid: "", password: "" };
    }
    onStage?.("write");
    for (let i = 0; i <= 25; i++) {
      onProgress?.(i / 25);
      if (i === 12 && failOnce.has("write")) {
        failOnce.delete("write");
        throw new FlashError("write", new Error("Timed out waiting for packet header"));
      }
      await sleep(110);
    }
    say(`Wrote ${image.length} bytes`);
    onStage?.("reset");
    say("Restarting the Buddy");
    board.answers = true;
    board.fw = params.get("newfw") || "1.2.0-rc1";
    knows = everything();
    board.added = (params.get("added") || "").split(",").filter(Boolean);
    if (board.added.length) board.cfg_v = 2;
    await sleep(300);
  }

  return { BuddyPort: FakeBuddyPort, flashImage, checkBuddy };
}
