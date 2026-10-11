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
