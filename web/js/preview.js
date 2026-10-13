// A virtual Buddy in its printed holder, showing the chosen theme, mounting
// side and pages live.
//
// The pages are ports of the firmware's drawClock, drawDatePage, drawWeather,
// drawMoon, drawStock, drawGithub and drawPageDots (src/main.cpp), with the same
// positions, text sizes and themed colours from applyTheme. Text uses a 5x7
// pixel font laid out like Adafruit GFX's classic font (6 px advance x size,
// cursor at the top left), so lines land where they land on the device.
// KEEP IN SYNC with src/main.cpp.

import { createFace, bitmapPath, BITMAPS, SCREEN_W, SCREEN_H } from "./face.js";
import { PAGE_KEYS } from "./settings.js";
import { S } from "./strings.js";

const NS = "http://www.w3.org/2000/svg";
const FG = "#ffffff";
const BG = "#000000";
const DOT_OFF = "#5a5a5a";   // rgb(90,90,90), drawPageDots
const MOON_RING = "#484848"; // rgb(72,72,72), drawMoonDisc
export const CYCLE_MS = 3000;

// The themed colour roles (COL_*) of applyTheme, theme 0-4. The firmware's
// rgb() packs into RGB565; these are the 8-bit values written in applyTheme.
const ROLES = ["time", "sec", "dateWd", "dateBig", "value", "label", "temp", "wicon", "wsub",
  "moon", "moonLab", "priceUp", "priceDown", "ticker", "ghLogo", "ghNum"];

function theme(over) {
  const t = {};
  for (const r of ROLES) t[r] = over[r] ?? FG; // everything defaults to white (FG)
  return Object.freeze(t);
}

const CY = "#00c8ff";   // rgb(0,200,255)
const GRAY = "#78828c"; // rgb(120,130,140)
export const THEMES = Object.freeze([
  theme({}), // 0 Classic
  theme({    // 1 Minimal
    sec: CY, dateWd: CY, temp: CY, moonLab: CY, priceUp: CY, priceDown: CY, ghNum: CY,
    label: GRAY, wsub: GRAY, moon: "#dcdcdc",
  }),
  theme({    // 2 Semantic
    sec: "#ffb428", dateWd: "#ffb428", temp: "#ff8c3c", wicon: "#ffd25a", wsub: "#3cc8c8",
    moon: "#ffd25a", moonLab: CY, priceUp: "#3cdc78", priceDown: "#ff505a", ghNum: "#3cdc78",
    label: GRAY,
  }),
  theme({    // 3 Warm amber
    time: "#ffb428", sec: "#ffd25a", dateWd: "#ffb428", dateBig: "#f5e1be", value: "#ebd7b4",
    label: "#967850", temp: "#ffb428", wicon: "#ffd25a", wsub: "#b4966e", moon: "#ffd25a",
    moonLab: "#ffb428", priceUp: "#ffb428", priceDown: "#ffb428", ticker: "#f5e1be",
    ghLogo: "#f5e1be", ghNum: "#ffb428",
  }),
  theme({    // 4 Cool teal / blue
    time: CY, sec: "#3cc8c8", dateWd: "#5aaaff", dateBig: "#cddceb", value: "#cddceb",
    label: "#96a0b9", temp: CY, wicon: "#5aaaff", wsub: "#3cc8c8", moon: "#d2e1f5",
    moonLab: CY, priceUp: CY, priceDown: CY, ticker: "#cddceb", ghLogo: "#cddceb", ghNum: CY,
  }),
]);

export function themeColors(n) {
  return THEMES[Number.isInteger(n) && n >= 0 && n < THEMES.length ? n : 0];
}

// The enabled pages in display order, as buildPageList() builds them: an empty
// github_user hides GitHub, an empty stock_key hides the stock page, and with
// nothing left the face is shown.
export function pageList(config) {
  const pages = (config && config.pages) || {};
  const list = PAGE_KEYS.filter((key) => {
    if (!pages[key]) return false;
    if (key === "github" && !config.github_user) return false;
    if (key === "stock" && !config.stock_key) return false;
    return true;
  });
  return list.length ? list : ["face"];
}

// ── 5x7 pixel font ────────────────────────────────────────
// Rows top to bottom, "#" lit. Only what the pages print: A-Z, 0-9 and $ % . - : / +.
const GLYPHS = {
  "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.", "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2": ".###.|#...#|....#|...#.|..#..|.#...|#####", "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
  "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.", "5": "#####|#....|####.|....#|....#|#...#|.###.",
  "6": "..##.|.#...|#....|####.|#...#|#...#|.###.", "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.", "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#", B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.", D: "###..|#..#.|#...#|#...#|#...#|#..#.|###..",
  E: "#####|#....|#....|####.|#....|#....|#####", F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####", H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.", J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#", L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#", N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.", P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#", R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.", T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.", V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.", X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|#...#|.#.#.|..#..|..#..|..#..", Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  ".": ".....|.....|.....|.....|.....|.##..|.##..", "-": ".....|.....|.....|#####|.....|.....|.....",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....", "/": ".....|....#|...#.|..#..|.#...|#....|.....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....", "%": "##...|##..#|...#.|..#..|.#...|#..##|...##",
  "$": "..#..|.####|#.#..|.###.|..#.#|####.|..#..",
};
GLYPHS["—"] = GLYPHS["-"]; // an em dash prints as the font's dash

// Path data for text at the GFX cursor (x, y), size = GFX text size.
export function textPath(text, x, y, size) {
  let d = "";
  [...String(text)].forEach((ch, i) => {
    const g = GLYPHS[ch.toUpperCase()];
    if (!g) return;
    const ox = x + i * 6 * size;
    g.split("|").forEach((row, r) => {
      let c = 0;
      while (c < 5) {
        if (row[c] !== "#") { c++; continue; }
        const start = c;
        while (c < 5 && row[c] === "#") c++;
        d += `M${ox + start * size} ${y + r * size}h${(c - start) * size}v${size}h${(start - c) * size}z`;
      }
    });
  });
  return d;
}

export const textWidth = (text, size) => [...String(text)].length * 6 * size;

const txt = (text, x, y, size, color) =>
  `<path fill="${color}" d="${textPath(text, x, y, size)}"/>`;
const centred = (text, y, size, color) =>
  txt(text, Math.floor((SCREEN_W - textWidth(text, size)) / 2), y, size, color);
const rrect = (x, y, w, h, r, color) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;

// ── Pages ─────────────────────────────────────────────────

// drawPageDots.
function dots(count, index) {
  const start = SCREEN_W / 2 - ((count - 1) * 16) / 2;
  let s = "";
  for (let i = 0; i < count; i++) {
    s += i === index
      ? `<circle cx="${start + i * 16}" cy="${SCREEN_H - 12}" r="3" fill="${FG}"/>`
      : `<circle cx="${start + i * 16}" cy="${SCREEN_H - 12}" r="2" fill="none" stroke="${DOT_OFF}" stroke-width="1.25"/>`;
  }
  return s;
}

// drawDigit / drawDigitSegment: 7-segment digits from rounded bars.
const SEG_MASKS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
function digit(x, y, n, w, h, t, color) {
  const half = h / 2;
  const r = t / 2;
  const segs = [
    [x + t, y, w - 2 * t, t], [x + w - t, y + t, t, half - t], [x + w - t, y + half, t, half - t],
    [x + t, y + h - t, w - 2 * t, t], [x, y + half, t, half - t], [x, y + t, t, half - t],
    [x + t, y + half - t / 2, w - 2 * t, t],
  ];
  return segs.map((s, i) => (SEG_MASKS[n % 10] & (1 << i) ? rrect(...s, r, color) : "")).join("");
}

const two = (n) => String(n).padStart(2, "0");

function drawClock(c, now, blinkColon) {
  const hh = now.getHours();
  const mm = now.getMinutes();
  const ss = now.getSeconds();
  const W = 54, H = 100, T = 10, Y = 18;
  let s = digit(8, Y, Math.floor(hh / 10), W, H, T, c.time) + digit(70, Y, hh % 10, W, H, T, c.time);
  if (!blinkColon || ss % 2 === 0) {
    s += rrect(134, Y + 28, 11, 11, 5, c.time) + rrect(134, Y + 62, 11, 11, 5, c.time);
  }
  s += digit(154, Y, Math.floor(mm / 10), W, H, T, c.time) + digit(216, Y, mm % 10, W, H, T, c.time);
  return s + txt(two(ss), 278, Y + H - 24, 3, c.sec);
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function drawDate(c, now) {
  return centred(WEEKDAYS[now.getDay()], 14, 4, c.dateWd)
    + centred(`${MONTHS[now.getMonth()]} ${two(now.getDate())}`, 62, 6, c.dateBig)
    + centred(String(now.getFullYear()), 126, 3, c.value);
}

// drawWeatherIcon for code 0 by day: a sun, outlined, with eight rays.
function sun(cx, cy, color) {
  let s = `<circle cx="${cx}" cy="${cy}" r="22" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  for (let i = 0; i < 8; i++) {
    const a = i * 0.7854;
    s += `<line x1="${(cx + Math.cos(a) * 30).toFixed(1)}" y1="${(cy + Math.sin(a) * 30).toFixed(1)}"`
      + ` x2="${(cx + Math.cos(a) * 40).toFixed(1)}" y2="${(cy + Math.sin(a) * 40).toFixed(1)}"`
      + ` stroke="${color}" stroke-width="1.5"/>`;
  }
  return s;
}

// Sample weather; the preview never fetches. 24 C is 75 F.
function drawWeather(c, config) {
  const f = config.temp_unit === "fahrenheit";
  const mph = config.wind_unit === "mph";
  const temp = f ? "75" : "24";
  const wind = `W ${mph ? 7 : 12}${mph ? "MPH" : "KMH"}`;
  return sun(250, 66, c.wicon)
    + txt(temp, 14, 34, 8, c.temp)
    + txt(f ? "F" : "C", 14 + textWidth(temp, 8), 34, 3, c.temp)
    + txt("CLEAR", 14, 116, 2, c.wsub)
    + txt("H 40%", 14, 140, 2, c.label)
    + txt(wind, SCREEN_W - 14 - textWidth(wind, 2), 140, 2, c.label);
}

// Moon age from local days since 1970, as drawMoon computes it.
export function moonPhase(date) {
  const syn = 29.53058867;
  const days = (date.getTime() - date.getTimezoneOffset() * 60000) / 86400000;
  const age = (((days - 10962.7597) % syn) + syn) % syn;
  const phase = age / syn;
  return { age, phase, light: Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50) };
}

export function moonLabel(p) {
  if (p < 0.03 || p > 0.97) return "NEW MOON";
  if (p < 0.22) return "WAXING CRESCENT";
  if (p < 0.28) return "FIRST QUARTER";
  if (p < 0.47) return "WAXING GIBBOUS";
  if (p < 0.53) return "FULL MOON";
  if (p < 0.72) return "WANING GIBBOUS";
  if (p < 0.78) return "LAST QUARTER";
  return "WANING CRESCENT";
}

// drawMoonDisc: a lit disc with a black disc slid across it for the shadow.
function moonDisc(cx, cy, radius, phase, color) {
  const circle = (x, r, fill, stroke) => (stroke
    ? `<circle cx="${x}" cy="${cy}" r="${r}" fill="none" stroke="${fill}" stroke-width="1.25"/>`
    : `<circle cx="${x}" cy="${cy}" r="${r}" fill="${fill}"/>`);
  let s = circle(cx, radius + 3, MOON_RING, true) + circle(cx, radius, color);
  if (phase < 0.03 || phase > 0.97) return s + circle(cx, radius - 2, BG) + circle(cx, radius, color, true);
  if (phase > 0.47 && phase < 0.53) return s;
  const shadowX = phase < 0.5
    ? cx - Math.trunc(4 * radius * phase)
    : cx + Math.trunc(2 * radius - 4 * radius * (phase - 0.5));
  return s + circle(shadowX, radius, BG) + circle(cx, radius, color, true);
}

function drawMoon(c, now) {
  const m = moonPhase(now);
  return moonDisc(240, 74, 58, m.phase, c.moon)
    + txt(moonLabel(m.phase), 10, 24, 2, c.moonLab)
    + txt(`AGE ${m.age.toFixed(1)} DAYS`, 10, 92, 2, c.value)
    + txt(`LIGHT ${m.light}%`, 10, 120, 2, c.value);
}

const DASH = "—";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function drawStock(c, config, live) {
  const price = isNum(live.price) ? `$${live.price.toFixed(2)}` : `$${DASH}`;
  const ticker = String(config.ticker || "").toUpperCase().slice(0, 10);
  let tsize = 4;
  while (tsize > 1 && ticker.length * 6 * tsize > 132) tsize--;
  // Without open/high/low the colour is the "up" one (price >= open).
  return centred(price, 26, 6, c.priceUp)
    + txt(ticker, 14, 124 - 4 * tsize, tsize, c.ticker)
    + txt(`OPEN  ${DASH}`, 150, 92, 2, c.value)
    + txt(`HIGH  ${DASH}`, 150, 116, 2, c.value)
    + txt(`LOW   ${DASH}`, 150, 140, 2, c.value);
}

const GITHUB_D = bitmapPath(BITMAPS.github);

// formatCount and followerTextSize port lib/display/display_fmt.cpp. KEEP IN SYNC.
// 0-99999 digits; 100000-999999 thousands + "k"; 1000000-9999999 one truncated
// decimal + "M"; 10000000 and up whole millions + "M"; negative "0".
export function formatCount(n) {
  n = Math.max(0, Math.trunc(n));
  if (n < 100000) return String(n);
  if (n < 1000000) return `${Math.floor(n / 1000)}k`;
  if (n < 10000000) {
    const tenths = Math.floor(n / 100000);
    return `${Math.floor(tenths / 10)}.${tenths % 10}M`;
  }
  return `${Math.floor(n / 1000000)}M`;
}

// Text size of the big follower number: 5 for exactly 5 characters (five size-6
// characters are 180 px and run off the 320 px screen from x=150), else 6.
export function followerTextSize(formatted) {
  return [...String(formatted)].length === 5 ? 5 : 6;
}

function drawGithub(c, live) {
  const followers = isNum(live.followers) ? formatCount(live.followers) : DASH;
  const repos = isNum(live.repos) ? formatCount(live.repos) : DASH;
  const rx = 150;
  return `<path fill="${c.ghLogo}" shape-rendering="crispEdges" transform="translate(14 ${(SCREEN_H - 112) / 2}) scale(2)" d="${GITHUB_D}"/>`
    + txt(followers, rx, 22, followerTextSize(followers), c.ghNum)
    + txt("FOLLOWERS", rx, 78, 2, c.label)
    + txt(repos, rx, 110, 3, c.value)
    + txt("REPOS", rx, 140, 1, c.label);
}

// ── The holder ────────────────────────────────────────────
// Scene units: the screen is 320x172 at (40, 40), inside the glass and the
// printed body; the tab runs behind the monitor's edge. For a right-side mount
// the holder is fitted upside down on the other side of the monitor, and the
// firmware turns the picture 180 degrees so it reads the right way up.
const VIEW_W = 460;
const VIEW_H = 252;
let uid = 0;

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const DEFAULT_CONFIG = { mount: "left", theme: 0, pages: { face: true } };

// How long the preview stays on the page a settings change affects.
export const HOLD_MS = 5000;

// Which page the preview shows, and when it moves on: the automatic cycle,
// the pause control, and the hold after a settings change. No DOM, so the
// tests can drive it with fake timers. onChange() runs whenever the page
// changes. reduced() is true under prefers-reduced-motion: no automatic cycle.
export class PageCycle {
  constructor({ onChange = () => {}, cycleMs = CYCLE_MS, reduced = () => false } = {}) {
    this.onChange = onChange;
    this.cycleMs = cycleMs;
    this.reduced = reduced;
    this.pages = ["face"];
    this.index = 0;
    this.paused = false;
    this.holding = false;
    this.timer = 0;
    this.holdTimer = 0;
  }

  get page() { return this.pages[this.index]; }

  // A new page list (pageList(config)). Keeps the current page if it is still
  // there. Returns true if the list changed.
  setPages(list) {
    if (list.join() === this.pages.join()) return false;
    const current = this.page;
    this.pages = [...list];
    const keep = this.pages.indexOf(current);
    this.index = keep >= 0 ? keep : 0;
    if (keep < 0) this.onChange();
    this.schedule();
    return true;
  }

  // The next page, by hand (a click on the preview). Ends a hold.
  next() {
    this.endHold();
    this.index = (this.index + 1) % this.pages.length;
    this.onChange();
    this.schedule();
  }

  setPaused(paused) {
    this.paused = !!paused;
    this.schedule();
  }

  // Show `page` and stay on it for holdMs, then cycle on (unless paused).
  // page null: stay on the current page, but restart the hold. A page that
  // isn't in the list (off, or hidden by an empty key or user) is not shown:
  // returns false and changes nothing.
  showPage(page, holdMs = HOLD_MS) {
    if (page !== null && page !== undefined) {
      const i = this.pages.indexOf(page);
      if (i < 0) return false;
      if (i !== this.index) { this.index = i; this.onChange(); }
    }
    clearTimeout(this.holdTimer);
    this.holding = true;
    this.holdTimer = setTimeout(() => { this.holding = false; this.holdTimer = 0; this.schedule(); }, holdMs);
    this.schedule();
    return true;
  }

  endHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.holding = false;
  }

  // The automatic cycle runs only with 2+ pages, no pause, no hold and no
  // reduced motion.
  schedule() {
    clearInterval(this.timer);
    this.timer = 0;
    if (this.pages.length > 1 && !this.reduced() && !this.paused && !this.holding) {
      this.timer = setInterval(() => {
        this.index = (this.index + 1) % this.pages.length;
        this.onChange();
      }, this.cycleMs);
    }
  }

  get cycling() { return this.timer !== 0; }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.holdTimer);
    this.timer = this.holdTimer = 0;
  }
}

// createPreview(container) -> { update(config, live?), showPage(page, holdMs?), setCompact(on), destroy() }.
// live is { price?, followers?, repos? } from successful checks.
export function createPreview(container) {
  const id = `buddy-preview-${++uid}`;
  const figure = document.createElement("figure");
  figure.className = "buddy-preview";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "buddy-preview__device";
  button.setAttribute("aria-label", S.previewLabel);
  const bar = document.createElement("figcaption");
  bar.className = "buddy-preview__bar";
  const caption = document.createElement("span");
  caption.className = "buddy-preview__caption";
  // WCAG 2.2.2: the automatic page cycle can be paused.
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "buddy-preview__pause";
  bar.append(caption, pause);

  const svg = el("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, "aria-hidden": "true", focusable: "false" });
  const defs = el("defs", {}, svg);
  const clip = el("clipPath", { id: `${id}-clip` }, defs);
  el("rect", { width: SCREEN_W, height: SCREEN_H, rx: 14 }, clip);
  const glare = el("linearGradient", { id: `${id}-glare`, x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
  el("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": "0.07" }, glare);
  el("stop", { offset: "0.45", "stop-color": "#fff", "stop-opacity": "0" }, glare);

  // Back to front: the holder's tab, the monitor's edge over it, the body.
  const holder = el("g", {}, svg);
  el("rect", { class: "bp-body", x: 360, y: 52, width: 92, height: 148, rx: 16 }, holder);
  const monitor = el("g", {}, svg);
  el("rect", { class: "bp-bezel", x: 424, y: -20, width: 80, height: VIEW_H + 40, rx: 10 }, monitor);
  el("rect", { class: "bp-panel", x: 438, y: -20, width: 80, height: VIEW_H + 40 }, monitor);
  const body = el("g", {}, svg);
  el("rect", { class: "bp-body", x: 14, y: 14, width: 372, height: 224, rx: 34 }, body);
  el("rect", { class: "bp-rim", x: 14.5, y: 14.5, width: 371, height: 223, rx: 33.5 }, body);
  el("rect", { class: "bp-port", x: 286, y: 233, width: 34, height: 5, rx: 2.5 }, body); // USB-C
  el("rect", { class: "bp-glass", x: 28, y: 28, width: 344, height: 196, rx: 24 }, body);
  const screen = el("g", { transform: "translate(40 40)" }, body);
  const content = el("g", { "clip-path": `url(#${id}-clip)` }, screen);
  el("rect", { width: SCREEN_W, height: SCREEN_H, fill: BG }, content);
  const page = el("g", {}, content);
  const faceHost = el("g", {}, content);
  const dotLayer = el("g", {}, content);
  el("rect", { x: 28, y: 28, width: 344, height: 196, rx: 24, fill: `url(#${id}-glare)`, "pointer-events": "none" }, body);

  button.appendChild(svg);
  figure.append(button, bar);
  container.appendChild(figure);

  let config = DEFAULT_CONFIG;
  let live = {};
  let face = null;
  let tick = 0;
  let compact = false;
  // The pause button's text sits in its own span, so the compact strip can
  // show the icon alone and keep the accessible name.
  const pauseText = document.createElement("span");
  pauseText.className = "buddy-preview__pause-text";
  pause.append(pauseText);

  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => !!(mq && mq.matches);
  const cycle = new PageCycle({ onChange: () => draw(), reduced });

  function layout() {
    const right = config.mount === "right";
    // Compact (the phone strip): the view is cropped to the screen itself. A
    // right mount turns the body 180 degrees, which moves the screen to x 100.
    svg.setAttribute("viewBox", compact ? `${right ? 100 : 40} 40 ${SCREEN_W} ${SCREEN_H}` : `0 0 ${VIEW_W} ${VIEW_H}`);
    figure.classList.toggle("buddy-preview--compact", compact);
    // Upside-down holder on the monitor's right edge; the screen turned back.
    holder.setAttribute("transform", right ? `rotate(180 ${VIEW_W / 2} ${VIEW_H / 2})` : "");
    body.setAttribute("transform", right ? `rotate(180 ${VIEW_W / 2} ${VIEW_H / 2})` : "");
    monitor.setAttribute("transform", right ? `translate(${VIEW_W} 0) scale(-1 1)` : "");
    content.setAttribute("transform", right ? `rotate(180 ${SCREEN_W / 2} ${SCREEN_H / 2})` : "");
  }

  function draw() {
    const key = cycle.page;
    const c = themeColors(config.theme);
    const now = new Date();
    if (key === "face") {
      page.innerHTML = "";
      if (!face) face = createFace(faceHost);
    } else {
      if (face) { face.destroy(); face = null; }
      const blink = !reduced();
      page.innerHTML = key === "clock" ? drawClock(c, now, blink)
        : key === "date" ? drawDate(c, now)
        : key === "weather" ? drawWeather(c, config)
        : key === "moon" ? drawMoon(c, now)
        : key === "stock" ? drawStock(c, config, live)
        : drawGithub(c, live);
    }
    dotLayer.innerHTML = dots(cycle.pages.length, cycle.index);

    let text = S.pageNames[key];
    if (key === "stock" && config.ticker) text += ` · ${String(config.ticker).toUpperCase()}`;
    if (key === "github") text += ` · ${config.github_user}`;
    const sample = (key === "weather")
      || (key === "stock" && !isNum(live.price))
      || (key === "github" && !isNum(live.followers));
    if (sample) text += ` (${S.previewSample})`;
    caption.textContent = text;
  }

  function syncPause() {
    pause.hidden = cycle.pages.length < 2 || reduced();
    pauseText.textContent = cycle.paused ? S.previewPlay : S.previewPause;
    pause.dataset.paused = String(cycle.paused);
  }

  // The clock's seconds and colon change every second.
  tick = setInterval(() => { if (cycle.page === "clock") draw(); }, 1000);

  const next = () => cycle.next();
  button.addEventListener("click", next);
  const togglePause = () => { cycle.setPaused(!cycle.paused); syncPause(); };
  pause.addEventListener("click", togglePause);
  const onMotion = () => { cycle.schedule(); draw(); syncPause(); };
  if (mq) mq.addEventListener("change", onMotion);

  function update(nextConfig, nextLive) {
    config = nextConfig || DEFAULT_CONFIG;
    live = nextLive || {};
    cycle.setPages(pageList(config));
    layout();
    draw();
    syncPause();
  }

  update(DEFAULT_CONFIG);

  return {
    update,
    // Jump to the page a settings change affects and hold it (PageCycle.showPage).
    showPage(pageKey, holdMs = HOLD_MS) { return cycle.showPage(pageKey, holdMs); },
    // The screen alone, without the holder and the monitor (the phone strip).
    setCompact(on) { compact = !!on; layout(); },
    destroy() {
      cycle.destroy();
      clearInterval(tick);
      if (face) face.destroy();
      if (mq) mq.removeEventListener("change", onMotion);
      button.removeEventListener("click", next);
      pause.removeEventListener("click", togglePause);
      figure.remove();
    },
  };
}
