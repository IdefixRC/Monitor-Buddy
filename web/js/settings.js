// Settings: validation, merging and backups. Pure: no DOM, no Web Serial.
//
// The validation rules mirror lib/settings/settings.cpp one to one (character
// sets, lengths, messages). KEEP IN SYNC with lib/settings/settings.cpp: the
// Buddy checks every value again, so a rule that drifts here only moves the
// error from the form to the board.

// Top-level keys in the firmware's order (ALL_KEYS) and the page names
// (SETTINGS_PAGE_KEYS).
export const KEYS = ["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
  "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages"];
export const PAGE_KEYS = ["face", "clock", "date", "weather", "moon", "stock", "github"];

const DIGITS = "0123456789";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// TEXT_KEYS in settings.cpp. maxLen is the char array size minus 1.
const TEXT_RULES = {
  github_user: { minLen: 0, maxLen: 39, chars: ALNUM + "-", error: "0-39 characters: letters, digits and -" },
  tz_name: { minLen: 1, maxLen: 64, chars: ALNUM + "/_+-", error: "1-64 characters: letters, digits and / _ + -" },
  tz_rule: { minLen: 1, maxLen: 64, chars: ALNUM + "<>+-:,./", error: "1-64 characters of a POSIX TZ rule" },
  ticker: { minLen: 1, maxLen: 10, chars: DIGITS + "ABCDEFGHIJKLMNOPQRSTUVWXYZ.-", error: "1-10 characters: A-Z, 0-9, . and -" },
  stock_key: { minLen: 0, maxLen: 64, chars: ALNUM + "_-", error: "0-64 characters: letters, digits, _ and -" },
};

// applyCoordinate: at most 15 characters (char lat[16]), only 0123456789.+- ,
// then a plain decimal within the limit. The pattern is what strtod accepts
// from that character set; NaN, infinity, hex and exponents cannot get in.
const COORD_MAX_LEN = 15;
const COORD_CHARS = "0123456789.+-";
const COORD_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function textError(rule, v) {
  if (typeof v !== "string") return rule.error;
  if (v.length < rule.minLen || v.length > rule.maxLen) return rule.error;
  for (const c of v) if (!rule.chars.includes(c)) return rule.error;
  return null;
}

function coordinateError(v, limit, message) {
  if (typeof v !== "string") return message;
  if (v.length < 1 || v.length > COORD_MAX_LEN) return message;
  for (const c of v) if (!COORD_CHARS.includes(c)) return message;
  if (!COORD_NUMBER.test(v)) return message;
  const d = Number(v);
  return d >= -limit && d <= limit ? null : message;
}

const choiceError = (v, a, b, message) => (v === a || v === b ? null : message);

// One top-level key other than "pages": the error message, or null if valid.
function keyError(key, v) {
  if (key in TEXT_RULES) return textError(TEXT_RULES[key], v);
  switch (key) {
    case "mount": return choiceError(v, "left", "right", 'must be "left" or "right"');
    case "theme":
      return Number.isInteger(v) && v >= 0 && v <= 4 ? null : "must be a whole number 0-4";
    case "lat": return coordinateError(v, 90, "a number from -90 to 90");
    case "lon": return coordinateError(v, 180, "a number from -180 to 180");
    case "temp_unit": return choiceError(v, "celsius", "fahrenheit", 'must be "celsius" or "fahrenheit"');
    case "wind_unit": return choiceError(v, "kmh", "mph", 'must be "kmh" or "mph"');
    default: return "unknown key";
  }
}

// settingsMerge for a (partial) config: { ok, errors }. Errors are keyed like
// the firmware's: "theme", "pages.clock", "pages". Unknown keys, "v" and
// unknown page names are ignored.
export function validateConfig(partial) {
  const errors = {};
  if (!isPlainObject(partial)) {
    errors.config = "must be an object";
    return { ok: false, errors };
  }
  for (const key of KEYS) {
    if (!Object.hasOwn(partial, key)) continue;
    const v = partial[key];
    if (key === "pages") {
      if (!isPlainObject(v)) { errors.pages = "must be an object"; continue; }
      for (const page of PAGE_KEYS) {
        if (!Object.hasOwn(v, page) || v[page] === null) continue; // missing stays as it is
        if (typeof v[page] !== "boolean") errors[`pages.${page}`] = "must be true or false";
      }
      continue;
    }
    const err = keyError(key, v);
    if (err) errors[key] = err;
  }
  return { ok: Object.keys(errors).length === 0, errors };
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

// A copy of `config` with only the known keys (and known page names).
function knownOnly(config) {
  const out = {};
  for (const key of KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const v = config[key];
    if (key === "pages" && isPlainObject(v)) {
      out.pages = {};
      for (const page of PAGE_KEYS) if (Object.hasOwn(v, page)) out.pages[page] = structuredClone(v[page]);
    } else {
      out[key] = structuredClone(v);
    }
  }
  return out;
}

// base with patch on top; pages merge per page. Unknown keys are dropped.
// Neither argument is changed.
export function mergeConfig(base, patch) {
  const out = knownOnly(isPlainObject(base) ? base : {});
  const p = knownOnly(isPlainObject(patch) ? patch : {});
  for (const key of Object.keys(p)) {
    if (key === "pages" && isPlainObject(p.pages) && isPlainObject(out.pages)) {
      out.pages = { ...out.pages, ...p.pages };
    } else {
      out[key] = p[key];
    }
  }
  return out;
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
