// The Buddy's @MB serial protocol, browser side. Pure: no Web Serial here.
// Same rules as the firmware (lib/protocol, src/main.cpp) and tools/mb_serial.py.
export const PREFIX = "@MB ";
export const MAX_ID = 2147483647;
// Error replies that can't carry the request's id (the Buddy never read it).
export const IDLESS_ERRORS = ["line too long", "bad json", "restarting"];
// Commands that change the board: send once, never resend; verify instead.
export const CHANGING = ["SET", "DEFAULTS", "REBOOT"];

export function makeIdSource(start = 1 + Math.floor(Math.random() * 2 ** 30)) {
  let last = start - 1;
  return () => { last = last < MAX_ID ? last + 1 : 0; return last; };
}

export function requestLine(cmd, id, body) {
  const payload = { id };
  if (body) for (const [k, v] of Object.entries(body)) if (k !== "id") payload[k] = v;
  return `${PREFIX}${cmd} ${JSON.stringify(payload)}\n`;
}

export class LineSplitter {
  constructor() { this.rest = ""; }
  push(text) {
    const parts = (this.rest + text).split("\n");
    this.rest = parts.pop();
    return parts.map((l) => l.replace(/\r$/, ""));
  }
}

export function parseReply(line) {
  if (!line.startsWith(PREFIX)) return null;
  try {
    const r = JSON.parse(line.slice(PREFIX.length));
    return r && typeof r === "object" && !Array.isArray(r) ? r : null;
  } catch {
    return null;
  }
}

export function answers(reply, cmd, id) {
  if (reply.cmd !== cmd) return false;
  if (reply.id === id) return true;
  return !("id" in reply) && reply.ok === false && IDLESS_ERRORS.includes(reply.error);
}

// What the port printed before we wrote anything, read for trouble (E2,
// 2026-10-12). A board that isn't running the firmware never reads USB, so
// every byte we send stays stuck in the port, and Chrome can't close a port
// with stuck bytes: only a replug frees it. So look first, and send nothing to:
//   "bootloop"  the bootloader finds no app (a cut-off flash) and restarts every
//               ~40 ms; or the ROM banner repeats (a clean boot prints it once);
//   "download"  the ROM waits in install mode.
// null: nothing wrong seen (a running Buddy, a clean boot, or silence).
const NO_APP = /No bootable app partitions|is not bootable|invalid magic byte|invalid segment length/;
export function romTrouble(lines) {
  let banners = 0;
  for (const line of lines) {
    if (NO_APP.test(line)) return "bootloop";
    if (/waiting for download/.test(line)) return "download";
    if (/^rst:0x/.test(line) && ++banners > 1) return "bootloop";
  }
  return null;
}
