// Import an Arduino config.h (the pre-1.2 way of configuring the Buddy).
// Pure: takes the file's text and the time zone table, returns settings.
import { ruleForZone, ruleFromOffset } from "./tz.js";

// Top-level settings keys in the firmware's order (lib/settings/settings.cpp).
const KEY_ORDER = ["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
  "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages"];

const PAGE_DEFINES = {
  SHOW_FACE: "face", SHOW_CLOCK: "clock", SHOW_DATE: "date", SHOW_WEATHER: "weather",
  SHOW_MOON: "moon", SHOW_STOCK: "stock", SHOW_GITHUB: "github",
};
// #define name -> settings key, for the plain one-to-one cases.
const DIRECT = {
  THEME: "theme", GITHUB_USER: "github_user", TIMEZONE: "tz_name", TICKER: "ticker",
  LAT: "lat", LONG: "lon", TEMP: "temp_unit", WIND: "wind_unit",
};
// Defines that feed another setting rather than mapping to one.
const HELPERS = ["TZ_RULE", "TZ_OFFSET_HOURS"];

// "..." with \" and \ escapes, or a bare token up to whitespace or "//".
function readValue(rest) {
  const s = rest.trimStart();
  if (s.startsWith('"')) {
    let out = "";
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length) { out += s[++i]; continue; }
      if (c === '"') return out;
      out += c;
    }
    return out; // unterminated: take what is there
  }
  const token = s.match(/^[^\s]*/)[0];
  const cut = token.indexOf("//");
  const bare = cut >= 0 ? token.slice(0, cut) : token;
  if (bare === "true") return true;
  if (bare === "false") return false;
  if (bare !== "" && Number.isFinite(Number(bare))) return Number(bare);
  return bare;
}

export function parseConfigH(text, table) {
  const defines = new Map();
  const skipped = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of stripped.split(/\r?\n/)) {
    const m = line.match(/^\s*#define\s+([A-Z_][A-Z0-9_]*)\s+(.*)$/);
    if (!m) continue;
    const [, name, rest] = m;
    const known = name === "MOUNTING_LOCATION" || name === "STOCKKEY" ||
      name in DIRECT || name in PAGE_DEFINES || HELPERS.includes(name);
    if (!known) { skipped.push(name); continue; }
    defines.set(name, readValue(rest));
  }

  const config = {};
  const mount = defines.get("MOUNTING_LOCATION");
  if (mount === "LEFT" || mount === "RIGHT") config.mount = mount.toLowerCase();
  for (const [name, key] of Object.entries(DIRECT)) {
    if (defines.has(name)) config[key] = defines.get(name);
  }
  if (defines.has("STOCKKEY")) {
    const k = defines.get("STOCKKEY");
    config.stock_key = k === "xxxxxxx" ? "" : k; // the template's placeholder
  }

  // tz_rule: a non-empty TZ_RULE, else the zone's rule, else the fixed offset.
  const explicit = defines.get("TZ_RULE");
  let rule = typeof explicit === "string" && explicit !== "" ? explicit : null;
  if (rule === null && typeof config.tz_name === "string") rule = ruleForZone(table, config.tz_name);
  if (rule === null && typeof defines.get("TZ_OFFSET_HOURS") === "number") {
    rule = ruleFromOffset(defines.get("TZ_OFFSET_HOURS"));
  }
  if (rule !== null) config.tz_rule = rule;

  const pages = {};
  for (const [name, page] of Object.entries(PAGE_DEFINES)) {
    if (typeof defines.get(name) === "boolean") pages[page] = defines.get(name);
  }
  if (Object.keys(pages).length) config.pages = pages;

  const imported = KEY_ORDER.filter((k) => k in config);
  const defaulted = KEY_ORDER.filter((k) => !(k in config));
  return { config, imported, skipped, defaulted };
}
