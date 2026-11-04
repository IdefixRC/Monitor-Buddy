// Settings: the schema, validation, merging and backups. Pure: no DOM, no Web
// Serial.
//
// SCHEMA mirrors the firmware's table (lib/settings/settings.cpp) row for row:
// names, rules and messages. The Buddy checks every value again; the shared
// cases in test/fixtures/settings-cases.json are run by both test suites, so a
// rule that drifts here fails a test instead of moving an error from the form
// to the board.

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = UPPER + "abcdefghijklmnopqrstuvwxyz" + DIGITS;
export const MSG_OBJECT = "must be an object";
const MSG_PAGE = "must be true or false";
const MSG_SLOTS = "1-5 entries; the first is always on";
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Rows: { name, kind, ...rules }. kind: "bool" | "int" (min, max) | "choice"
// (words) | "text" (min, max = length, chars, check?) | "coord" (max = limit) |
// "group" (children, check?, error for the check) | "list" (min, max = entries,
// error, and item for a list of values or fields + entryDefault for records).
export const SCHEMA = Object.freeze([
  { name: "mount", kind: "choice", words: ["left", "right"], error: 'must be "left" or "right"' },
  { name: "theme", kind: "int", min: 0, max: 4, error: "must be a whole number 0-4" },
  { name: "brightness", kind: "int", min: 8, max: 255, error: "a number from 8 to 255" },
  { name: "github_user", kind: "text", min: 0, max: 39, chars: ALNUM + "-", error: "0-39 characters: letters, digits and -" },
  { name: "tz_name", kind: "text", min: 1, max: 64, chars: ALNUM + "/_+-", error: "1-64 characters: letters, digits and / _ + -" },
  { name: "tz_rule", kind: "text", min: 1, max: 64, chars: ALNUM + "<>+-:,./", error: "1-64 characters of a POSIX TZ rule" },
  { name: "ticker", kind: "text", min: 1, max: 10, chars: UPPER + DIGITS + ".-", error: "1-10 characters: A-Z, 0-9, . and -" },
  { name: "stocks", kind: "list", min: 1, max: 5, error: MSG_SLOTS,
    entryDefault: { symbol: "AAPL", on: true },
    check: (entries) => isPlainObject(entries[0]) && entries[0].on !== false,
    fields: [
      { name: "symbol", kind: "text", min: 1, max: 10, chars: UPPER + DIGITS + ".-", error: "1-10 characters: A-Z, 0-9, . and -" },
      { name: "on", kind: "bool", error: MSG_PAGE },
    ] },
  { name: "stock_key", kind: "text", min: 0, max: 64, chars: ALNUM + "_-", error: "0-64 characters: letters, digits, _ and -" },
  { name: "coins", kind: "list", min: 1, max: 5, error: MSG_SLOTS,
    entryDefault: { pair: "BTC-USD", source: "coinbase", on: true },
    check: (entries) => isPlainObject(entries[0]) && entries[0].on !== false,
    fields: [
      { name: "pair", kind: "text", min: 3, max: 21, chars: UPPER + DIGITS + "-", check: (s) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(s), error: "3-21 characters: A-Z, 0-9 and one -" },
      { name: "source", kind: "choice", words: ["coinbase", "finnhub"], error: 'must be "coinbase" or "finnhub"' },
      { name: "on", kind: "bool", error: MSG_PAGE },
    ] },
  { name: "lat", kind: "coord", max: 90, error: "a number from -90 to 90" },
  { name: "lon", kind: "coord", max: 180, error: "a number from -180 to 180" },
  { name: "clock_format", kind: "choice", words: ["24h", "12h"], error: 'must be "24h" or "12h"' },
  { name: "temp_unit", kind: "choice", words: ["celsius", "fahrenheit"], error: 'must be "celsius" or "fahrenheit"' },
  { name: "wind_unit", kind: "choice", words: ["kmh", "mph"], error: 'must be "kmh" or "mph"' },
  { name: "night", kind: "group", check: (n) => n.start !== n.end, error: "start and end must differ", children: [
    { name: "enabled", kind: "bool", error: MSG_PAGE },
    { name: "start", kind: "int", min: 0, max: 23, error: "a whole hour 0-23" },
    { name: "end", kind: "int", min: 0, max: 23, error: "a whole hour 0-23" },
    { name: "brightness", kind: "int", min: 8, max: 255, error: "a number from 8 to 255" },
  ] },
  { name: "pages", kind: "group", children: ["face", "clock", "date", "weather", "moon", "stock", "github", "coin"]
    .map((name) => ({ name, kind: "bool", error: MSG_PAGE })) },
]);

// Top-level keys in the firmware's order, and the page names.
export const KEYS = SCHEMA.map((f) => f.name);
export const PAGE_KEYS = SCHEMA.find((f) => f.name === "pages").children.map((c) => c.name);

// coordOk (lib/settings/schema.cpp): at most 15 characters (char lat[16]), only
// 0123456789.+- , then a plain decimal within the limit. The pattern is what strtod accepts
// from that character set; NaN, infinity, hex and exponents cannot get in.
const COORD_MAX_LEN = 15;
const COORD_CHARS = "0123456789.+-";
const COORD_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

const present = (o, k) => Object.hasOwn(o, k) && o[k] !== null;

function coordinateError(v, limit, message) {
  if (typeof v !== "string") return message;
  if (v.length < 1 || v.length > COORD_MAX_LEN) return message;
  for (const c of v) if (!COORD_CHARS.includes(c)) return message;
  if (!COORD_NUMBER.test(v)) return message;
  const d = Number(v);
  return d >= -limit && d <= limit ? null : message;
}

// One value against a non-group, non-list row: the message, or null.
function scalarError(f, v) {
  switch (f.kind) {
    case "bool": return typeof v === "boolean" ? null : f.error;
    case "int": return Number.isInteger(v) && v >= f.min && v <= f.max ? null : f.error;
    case "choice": return typeof v === "string" && f.words.includes(v) ? null : f.error;
    case "text": {
      if (typeof v !== "string" || v.length < f.min || v.length > f.max) return f.error;
      for (const c of v) if (!f.chars.includes(c)) return f.error;
      return f.check && !f.check(v) ? f.error : null;
    }
    case "coord": return coordinateError(v, f.max, f.error);
    default: return f.error;
  }
}

function groupErrors(f, v, current, errors) {
  if (!isPlainObject(v)) { errors[f.name] = MSG_OBJECT; return; }
  let bad = false;
  for (const c of f.children) {
    if (!present(v, c.name)) continue;          // missing or null: unchanged
    const e = scalarError(c, v[c.name]);
    if (e) { errors[`${f.name}.${c.name}`] = e; bad = true; }
  }
  if (bad || !f.check) return;
  const merged = { ...(isPlainObject(current) ? current : {}) };
  for (const c of f.children) if (present(v, c.name)) merged[c.name] = v[c.name];
  if (f.children.every((c) => Object.hasOwn(merged, c.name)) && !f.check(merged)) errors[f.name] = f.error;
}

function listErrors(f, v, errors) {
  if (!Array.isArray(v) || v.length < f.min || v.length > f.max) { errors[f.name] = f.error; return; }
  v.forEach((x, i) => {
    const at = `${f.name}[${i}]`;
    if (f.item) {
      const e = scalarError(f.item, x);
      if (e) errors[at] = e;
      return;
    }
    if (!isPlainObject(x)) { errors[at] = MSG_OBJECT; return; }
    for (const c of f.fields) {
      if (!present(x, c.name)) continue;          // the entry default applies
      const e = scalarError(c, x[c.name]);
      if (e) errors[`${at}.${c.name}`] = e;
    }
  });
  const entryErrors = Object.keys(errors).some((k) => k.startsWith(`${f.name}[`));
  if (!entryErrors && f.check && !f.check(v)) errors[f.name] = f.error;
}

// The firmware's settingsMerge for a (partial) config against `schema`:
// { ok, errors }, errors keyed by path ("theme", "pages.clock", "coins[1].pair").
// `current` (the settings the patch goes onto) lets a group check see fields
// the patch doesn't change. Unknown keys and "v" are ignored.
export function validateWith(schema, partial, current = null) {
  if (!isPlainObject(partial)) return { ok: false, errors: { config: MSG_OBJECT } };
  const errors = {};
  for (const f of schema) {
    if (!Object.hasOwn(partial, f.name)) continue;
    const v = partial[f.name];
    if (f.kind === "group") groupErrors(f, v, current && current[f.name], errors);
    else if (f.kind === "list") listErrors(f, v, errors);
    else {
      const e = scalarError(f, v);
      if (e) errors[f.name] = e;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export const validateConfig = (partial, current = null) => validateWith(SCHEMA, partial, current);

const pick = (o, fields) => {
  const out = {};
  for (const c of fields) if (Object.hasOwn(o, c.name)) out[c.name] = structuredClone(o[c.name]);
  return out;
};

// A copy of `config` with only the schema's keys, group fields and record
// fields, in schema order.
export function knownWith(schema, config) {
  const out = {};
  for (const f of schema) {
    if (!Object.hasOwn(config, f.name)) continue;
    const v = config[f.name];
    if (f.kind === "group" && isPlainObject(v)) out[f.name] = pick(v, f.children);
    else if (f.kind === "list" && f.fields && Array.isArray(v)) out[f.name] = v.map((e) => (isPlainObject(e) ? pick(e, f.fields) : structuredClone(e)));
    else out[f.name] = structuredClone(v);
  }
  return out;
}

const knownOnly = (config) => knownWith(SCHEMA, config);

// base with patch on top: groups merge per field, lists are replaced whole and
// record fields the patch leaves out take the entry default. Unknown keys are
// dropped. Neither argument is changed.
export function mergeWith(schema, base, patch) {
  const out = knownWith(schema, isPlainObject(base) ? base : {});
  const p = knownWith(schema, isPlainObject(patch) ? patch : {});
  for (const f of schema) {
    if (!Object.hasOwn(p, f.name)) continue;
    const v = p[f.name];
    if (f.kind === "group" && isPlainObject(v) && isPlainObject(out[f.name])) {
      out[f.name] = { ...out[f.name] };
      for (const c of f.children) if (present(v, c.name)) out[f.name][c.name] = v[c.name];
    } else if (f.kind === "list" && f.fields && Array.isArray(v)) {
      out[f.name] = v.map((e) => {
        if (!isPlainObject(e)) return e;
        const filled = { ...f.entryDefault };
        for (const c of f.fields) if (present(e, c.name)) filled[c.name] = e[c.name];
        return filled;
      });
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

// mergeWith plus the ticker/stocks link (firmware settingsMerge does the same):
// stocks in the patch set ticker; ticker alone replaces the first stock.
export function mergeConfig(base, patch) {
  const out = mergeWith(SCHEMA, base, patch);
  const p = isPlainObject(patch) ? patch : {};
  const first = Array.isArray(out.stocks) && isPlainObject(out.stocks[0]) ? out.stocks[0] : null;
  if (first && Object.hasOwn(p, "stocks")) out.ticker = first.symbol;
  else if (first && typeof p.ticker === "string") out.stocks = [{ ...first, symbol: p.ticker }, ...out.stocks.slice(1)];
  return out;
}

// A 1.2 config (ticker, no stocks) as 1.3 sees it: the ticker is the first stock.
export function withStocks(config) {
  const out = structuredClone(isPlainObject(config) ? config : {});
  if (typeof out.ticker === "string" && !Object.hasOwn(out, "stocks")) out.stocks = [{ symbol: out.ticker, on: true }];
  return out;
}

// UTF-8 length: the firmware counts bytes (strlen).
const byteLength = (s) => new TextEncoder().encode(s).length;

// wifiValidate: ssid 1-32 bytes; password required as text, "" for an open
// network, otherwise 8-63 bytes. Errors: "wifi", "wifi.ssid", "wifi.password".
export function validateWifi(wifi) {
  const errors = {};
  if (!isPlainObject(wifi)) return { ok: false, errors: { wifi: "must be an object" } };
  const { ssid, password } = wifi;
  if (typeof ssid !== "string" || byteLength(ssid) < 1 || byteLength(ssid) > 32) {
    errors["wifi.ssid"] = "must be 1-32 characters";
  }
  if (typeof password !== "string") {
    // Required, so a form can't save an open network by forgetting the field.
    errors["wifi.password"] = "must be text (empty for an open network)";
  } else {
    const n = byteLength(password);
    if (n !== 0 && (n < 8 || n > 63)) errors["wifi.password"] = "must be empty or 8-63 characters";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// The backup file. Only settings go in: never the Wi-Fi name or password, so
// anything but the known keys is left out.
export function makeBackup(config, fw, now) {
  return {
    monitor_buddy_backup: 1,
    fw,
    saved: now.toISOString(),
    config: knownOnly(isPlainObject(config) ? config : {}),
  };
}

export class BadBackup extends Error {
  constructor(message) { super(message); this.name = "BadBackup"; }
}

// The partial config inside a parsed backup file. Not validated: pass the
// result to validateConfig.
export function readBackup(json) {
  if (!isPlainObject(json) || typeof json.monitor_buddy_backup !== "number") {
    throw new BadBackup("not a Monitor Buddy backup");
  }
  if (!isPlainObject(json.config)) throw new BadBackup("the backup has no settings");
  return knownOnly(json.config);
}

// monitor-buddy-settings-YYYY-MM-DD.json, with the date on the user's clock.
export function backupFileName(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `monitor-buddy-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// ── Which settings the board understands (spec §5.3) ──────

// The paths firmware 1.2.0 knows. Frozen on purpose, never derived from SCHEMA:
// the live flasher can be ahead of the released firmware, and a form with no
// GET to go by (path B) must not offer settings 1.2.0 would drop.
export const BASELINE_PATHS = Object.freeze(["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
  "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages.face", "pages.clock", "pages.date",
  "pages.weather", "pages.moon", "pages.stock", "pages.github"]);

// What each settings format (releases.json "cfg_v", CONFIG_VERSION) knows.
// An entry is frozen once a final release with that cfg_v exists; until 1.3
// is released, entry 2 may still grow (spec stocks-and-coins §9).
export const PATHS_BY_CFG = Object.freeze({
  1: BASELINE_PATHS,
  2: Object.freeze([...BASELINE_PATHS, "stocks", "stocks.symbol", "stocks.on",
    "coins", "coins.pair", "coins.source", "coins.on", "pages.coin",
    "clock_format", "night.enabled", "night.start", "night.end", "night.brightness",
    "brightness"]),
});
const KNOWN_CFG = Object.keys(PATHS_BY_CFG).map(Number).sort((a, b) => a - b);

// The paths a firmware with settings format `cfgV` supports.
export function pathsForCfg(cfgV) {
  const v = Number(cfgV);
  if (!Number.isFinite(v)) return PATHS_BY_CFG[1];
  const known = KNOWN_CFG.filter((k) => k <= v);
  return PATHS_BY_CFG[known.length ? known[known.length - 1] : 1];
}

// Every path some offered release supports: what may be shown greyed out.
export function installablePaths(releases) {
  const out = new Set();
  for (const e of releases || []) for (const p of pathsForCfg(e.cfg_v)) out.add(p);
  return out;
}

// The paths a GET config reports that this flasher knows: plain keys by name,
// group fields as "group.field", lists by name, record fields as "list.field"
// (from the first entry).
export function supportedPaths(config) {
  const out = new Set();
  if (!isPlainObject(config)) return out;
  for (const f of SCHEMA) {
    if (!Object.hasOwn(config, f.name)) continue;
    const v = config[f.name];
    if (f.kind === "group") {
      if (isPlainObject(v)) for (const c of f.children) if (Object.hasOwn(v, c.name)) out.add(`${f.name}.${c.name}`);
    } else if (f.kind === "list") {
      if (!Array.isArray(v)) continue;
      out.add(f.name);
      if (f.fields && isPlainObject(v[0])) for (const c of f.fields) if (Object.hasOwn(v[0], c.name)) out.add(`${f.name}.${c.name}`);
    } else {
      out.add(f.name);
    }
  }
  return out;
}

// `config` with only the supported paths (known keys only).
export function filterSupported(config, supported) {
  const known = knownOnly(isPlainObject(config) ? config : {});
  const out = {};
  for (const f of SCHEMA) {
    if (!Object.hasOwn(known, f.name)) continue;
    const v = known[f.name];
    if (f.kind === "group") {
      if (!isPlainObject(v)) {
        if (f.children.some((c) => supported.has(`${f.name}.${c.name}`))) out[f.name] = v;
        continue;
      }
      const g = {};
      for (const c of f.children) if (Object.hasOwn(v, c.name) && supported.has(`${f.name}.${c.name}`)) g[c.name] = v[c.name];
      if (Object.keys(g).length) out[f.name] = g;
    } else if (!supported.has(f.name)) {
      continue;
    } else if (f.kind === "list" && f.fields && Array.isArray(v)) {
      out[f.name] = v.map((e) => (isPlainObject(e)
        ? Object.fromEntries(Object.entries(e).filter(([k]) => supported.has(`${f.name}.${k}`)))
        : e));
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

// The top-level keys of `config` that filterSupported would cut, in schema order.
export function unsupportedKeys(config, supported) {
  const known = knownOnly(isPlainObject(config) ? config : {});
  const kept = filterSupported(known, supported);
  return Object.keys(known).filter((k) => JSON.stringify(known[k]) !== JSON.stringify(kept[k]));
}

// Paths `after` has and `before` hadn't: settings a flash brought.
export const newlyOffered = (before, after) => [...after].filter((p) => !before.has(p));

// [path, value] pairs: group fields one by one, everything else whole.
export function flattenPaths(config) {
  const out = [];
  for (const [k, v] of Object.entries(isPlainObject(config) ? config : {})) {
    const f = SCHEMA.find((x) => x.name === k);
    if (f && f.kind === "group" && isPlainObject(v)) for (const [c, x] of Object.entries(v)) out.push([`${k}.${c}`, x]);
    else out.push([k, v]);
  }
  return out;
}
