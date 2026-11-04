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
import { S } from "./strings.js";
import { coinPriceKey } from "./coins.js";

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

// PAGE_SHOW_ORDER in src/main.cpp. KEEP IN SYNC.
export const SHOWN_ORDER = ["face", "clock", "date", "weather", "moon", "stock", "coin", "github"];

// The coins that are on and usable, in slot order, each with its slot: Coinbase
// needs nothing, Finnhub needs the stock key (buildCoinList / coinConfigured).
export const usableCoins = (config) => (Array.isArray(config && config.coins) ? config.coins : [])
  .map((c, slot) => ({ ...c, slot }))
  .filter((c) => c && c.pair && c.on !== false && (c.source === "finnhub" ? !!config.stock_key : true));

// The enabled pages in display order, as buildPageList() builds them: an empty
// github_user hides GitHub, an empty stock_key hides the stock page, no usable
// coin hides the coin page, and with nothing left the face is shown.
export function pageList(config) {
  const pages = (config && config.pages) || {};
  const list = SHOWN_ORDER.filter((key) => {
    if (!pages[key]) return false;
    if (key === "coin" && !usableCoins(config).length) return false;
    if (key === "github" && !config.github_user) return false;
    if (key === "stock" && !config.stock_key) return false;
    return true;
  });
  return list.length ? list : ["face"];
}

// ── 5x7 pixel font ────────────────────────────────────────
// Rows top to bottom, "#" lit. Only what the pages print: A-Z, 0-9 and $ £ € % . - : / +.
export const GLYPHS = {
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
GLYPHS["£"] = "..##.|.#..#|.#...|###..|.#...|.#...|#####"; // the firmware's drawn glyphs
GLYPHS["€"] = "..###|.#...|####.|.#...|####.|.#...|..###";
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

export function drawClock(c, now, blinkColon, h12 = false) {
  const hh24 = now.getHours();
  const hh = h12 ? (hh24 % 12 || 12) : hh24;
  const mm = now.getMinutes();
  const ss = now.getSeconds();
  const W = 54, H = 100, T = 10, Y = 18;
  // 12-hour: no leading zero, AM/PM above the seconds (ports PR #22).
  let s = (!h12 || hh >= 10 ? digit(8, Y, Math.floor(hh / 10), W, H, T, c.time) : "") + digit(70, Y, hh % 10, W, H, T, c.time);
  if (h12) s += txt(hh24 < 12 ? "AM" : "PM", 282, Y + 4, 2, c.sec);
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

// subDotY in lib/display/display_fmt.cpp. KEEP IN SYNC.
export function subDotY(index, count, screenH) {
  return Math.trunc(screenH / 2) - Math.trunc(((count - 1) * 14) / 2) + index * 14;
}

// The stocks that are on, in slot order, each with its slot (0-4).
const activeStocks = (config) => (Array.isArray(config.stocks) ? config.stocks : [])
  .map((s, slot) => ({ ...s, slot })).filter((s) => s.symbol && s.on !== false);

const tickerOf = (config, entry) =>
  String(entry ? entry.symbol : config.ticker || "").toUpperCase().slice(0, 10);
const priceOf = (live, ticker) => (live.prices ? live.prices[ticker] : undefined);

function drawStock(c, config, live, entry) {
  const ticker = tickerOf(config, entry);
  const p = priceOf(live, ticker);
  const price = isNum(p) ? `$${p.toFixed(2)}` : `$${DASH}`;
  let tsize = 4;
  while (tsize > 1 && ticker.length * 6 * tsize > 132) tsize--;
  // Without open/high/low the colour is the "up" one (price >= open).
  return centred(price, 26, 6, c.priceUp)
    + txt(ticker, 14, 124 - 4 * tsize, tsize, c.ticker)
    + txt(`OPEN  ${DASH}`, 150, 92, 2, c.value)
    + txt(`HIGH  ${DASH}`, 150, 116, 2, c.value)
    + txt(`LOW   ${DASH}`, 150, 140, 2, c.value);
}

// ── Coin page ─────────────────────────────────────────────

// formatCoinPrice and currencyOf port lib/coin/coin.cpp. KEEP IN SYNC.
// 2 decimals from 1 up; 4 significant digits below 1 (decimals = 3 - floor(log10 v),
// at most 12); "0.00" for zero, negative or non-finite. Rounds like snprintf: the
// exact binary value, an exact tie going to the even digit.
export function formatCoinPrice(v) {
  if (!Number.isFinite(v) || !(v > 0)) return "0.00";
  const decimals = v >= 1 ? 2 : Math.min(12, 3 - Math.floor(Math.log10(v)));
  if (v >= 1e21) return `${BigInt(v)}.00`;
  const full = v.toFixed(100);   // the exact decimal expansion of the double
  const dot = full.indexOf(".");
  if (/^50*$/.test(full.slice(dot + 1 + decimals))) {
    const kept = full.slice(0, dot + 1 + decimals);
    if ((kept.charCodeAt(kept.length - 1) - 48) % 2 === 0) return kept;
  }
  return v.toFixed(decimals);
}

export function currencyOf(pair) {
  const text = String(pair);
  const dash = text.indexOf("-");
  const code = dash >= 0 ? text.slice(dash + 1) : text;
  const mark = code === "USD" || code === "USDT" ? "dollar" : code === "GBP" ? "pound" : code === "EUR" ? "euro" : "code";
  return { mark, code };
}

// The price line's text size: the largest of 6..3 where the mark plus the
// number fits 288 px (304 less 16), as drawCoin picks it.
export function coinPriceSize(markUnits, numLen) {
  let size = 6;
  while (size > 3 && (markUnits + numLen) * 6 * size > 304 - 16) size--;
  return size;
}

// A click steps to the next entry of a page with several; after the last it
// moves on to the next page (the device wraps within the entries instead).
export function clickStep(index, count) {
  return index + 1 < count ? { index: index + 1, nextPage: false } : { index: 0, nextPage: true };
}

// Sample values for a coin the preview has no live data for.
const SAMPLE_PRICES = { BTC: 104532.12, ETH: 3421.5, SOL: 168.42, XRP: 2.31, DOGE: 0.1834, ADA: 0.6512 };
const SHAPE = (i) => 1 + 0.012 * Math.sin(i / 3.5) + 0.0009 * (i - 12);
const sampleChart = (price) => Array.from({ length: 24 }, (_, i) => (price * SHAPE(i)) / SHAPE(24));

// The data drawCoin draws: live where there is some, else samples. Without a
// live reference the colour is "up" and there is no % line, like the stock page.
function coinData(entry, live) {
  const pair = String(entry.pair).toUpperCase();
  const base = pair.split("-")[0];
  const liveP = live.coinPrices ? live.coinPrices[coinPriceKey(entry.source, pair)] : undefined;
  // Nothing writes live.coinCharts yet: the chart stays a sample curve.
  const liveChart = live.coinCharts ? live.coinCharts[pair] : undefined;
  const havePrice = isNum(liveP) && liveP > 0;
  const price = havePrice ? liveP : (SAMPLE_PRICES[base] ?? 12.3456);
  const chart = Array.isArray(liveChart) ? liveChart : sampleChart(price);
  const hi = Math.max(...chart);
  const lo = Math.min(...chart);
  return {
    pair, base, price, chart,
    ref: havePrice ? 0 : chart[0], open: havePrice ? 0 : chart[0] * 1.003,
    high: havePrice ? 0 : hi * 1.002, low: havePrice ? 0 : lo * 0.998,
  };
}

const signed = (v) => `${v < 0 ? "-" : "+"}${Math.abs(v).toFixed(2)}%`;

// drawCoinChart: the 24 h closes plus the live price scaled into the box, a
// dotted line at the reference when it is inside the range, a 2 px line and a dot.
function coinChart(c, d, haveRef, col, sx, sy, sw, sh) {
  if (d.chart.length < 2) return txt("CHART LOADING", sx + 30, sy + Math.trunc(sh / 2) - 4, 1, c.label);
  const pts = [...d.chart.slice(0, 24), d.price];
  let lo = Math.min(...pts);
  let hi = Math.max(...pts);
  if (hi - lo <= hi * 1e-6) { const pad = hi * 5e-4 + 1e-9; hi += pad; lo -= pad; }
  let s = "";
  if (haveRef && d.ref >= lo && d.ref <= hi) {
    const ry = sy + sh - 1 - Math.round(((d.ref - lo) / (hi - lo)) * (sh - 1));
    s += `<line x1="${sx}" y1="${ry + 0.5}" x2="${sx + sw}" y2="${ry + 0.5}" stroke="#505050" stroke-width="1" stroke-dasharray="1 3"/>`;
  }
  const xy = pts.map((p, i) => [
    sx + Math.round((i * (sw - 1)) / (pts.length - 1)),
    sy + sh - 1 - Math.round(((p - lo) / (hi - lo)) * (sh - 1)),
  ]);
  s += `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" points="${xy.map(([x, y]) => `${x + 0.5},${y + 1}`).join(" ")}"/>`;
  const [px, py] = xy[xy.length - 1];
  return s + `<circle cx="${px}" cy="${py}" r="3" fill="${col}"/>`;
}

// drawCoin. live.coinStates[key] "notfound" / "updating" draw those states.
export function drawCoin(c, entry, live) {
  const key = coinPriceKey(entry.source, String(entry.pair).toUpperCase());
  const state = live.coinStates ? live.coinStates[key] : undefined;
  if (state === "notfound") return centred("NOT FOUND", 56, 3, FG) + centred(String(entry.pair).toUpperCase(), 100, 2, FG);
  if (state === "updating") return centred("UPDATING", 74, 3, FG);

  const d = coinData(entry, live);
  const finnhub = entry.source === "finnhub";
  const ref = finnhub && d.ref <= 0 ? d.open : d.ref;   // Finnhub: previous close, else the open
  const haveRef = ref > 0;
  const col = !haveRef || d.price >= ref ? c.priceUp : c.priceDown;

  const num = formatCoinPrice(d.price);
  const cur = currencyOf(d.pair);
  const mark = cur.mark === "dollar" ? "$" : cur.mark === "pound" ? "£" : cur.mark === "euro" ? "€" : `${cur.code} `;
  const psize = coinPriceSize([...mark].length, num.length);
  const lineW = ([...mark].length + num.length) * 6 * psize;
  let s = txt(mark + num, Math.max(0, Math.floor((304 - lineW) / 2)), 18 + (6 - psize) * 4, psize, col);
  const base = d.base.slice(0, 11);
  const pct = haveRef ? signed(((d.price - ref) / ref) * 100) : "";

  if (!finnhub) {
    let bsize = 4;
    while (bsize > 1 && base.length * 6 * bsize > 112) bsize--;   // the chart starts at x 132
    s += txt(base, 14, 82 + (4 - bsize) * 4, bsize, c.ticker);
    if (haveRef) s += txt(pct, 14, 120, 2, col);
    if (d.high > 0 && d.low > 0) s += txt(`H ${formatCoinPrice(d.high)}  L ${formatCoinPrice(d.low)}`, 14, 144, 1, c.label);
    return s + coinChart(c, d, haveRef, col, 132, 82, SCREEN_W - 17 - 132, 58);
  }
  // Finnhub: the stock page's layout, with the coin's base code.
  let tsize = 4;
  while (tsize > 1 && base.length * 6 * tsize > 132) tsize--;
  s += txt(base, 14, (haveRef ? 112 : 124) - 4 * tsize, tsize, c.ticker);
  if (haveRef) s += txt(pct, 14, 132, 2, col);
  const vals = [d.open, d.high, d.low].map(formatCoinPrice);   // the device prints "0.00" for an unknown value
  const mx = Math.max(...vals.map((v) => v.length));
  const vsize = (6 + mx) * 12 <= 306 - 150 ? 2 : 1;   // the longest value must end before x 306
  return s + txt(`OPEN  ${vals[0]}`, 150, 92, vsize, c.value)
    + txt(`HIGH  ${vals[1]}`, 150, 116, vsize, c.value)
    + txt(`LOW   ${vals[2]}`, 150, 140, vsize, c.value);
}

// A coin is live when its price came from a Check (and, on Coinbase, its chart).
const coinIsLive = (entry, live) => {
  const pair = String(entry.pair).toUpperCase();
  const p = live.coinPrices ? live.coinPrices[coinPriceKey(entry.source, pair)] : undefined;
  return isNum(p) && p > 0 && (entry.source === "finnhub" || (live.coinCharts && Array.isArray(live.coinCharts[pair])));
};

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
// live is { prices?: {SYMBOL: price}, followers?, repos? } from successful checks.
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
  const sub = { stock: 0, coin: 0 };   // the entry shown on the stock and the coin page
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
    const stocks = activeStocks(config);
    const coins = usableCoins(config);
    const entry = stocks.length ? stocks[sub.stock % stocks.length] : null;
    const coinEntry = coins.length ? coins[sub.coin % coins.length] : null;
    if (key === "face") {
      page.innerHTML = "";
      if (!face) face = createFace(faceHost);
    } else {
      if (face) { face.destroy(); face = null; }
      const blink = !reduced();
      page.innerHTML = key === "clock" ? drawClock(c, now, blink, config.clock_format === "12h")
        : key === "date" ? drawDate(c, now)
        : key === "weather" ? drawWeather(c, config)
        : key === "moon" ? drawMoon(c, now)
        : key === "stock" ? drawStock(c, config, live, entry)
        : key === "coin" ? (coinEntry ? drawCoin(c, coinEntry, live) : "")
        : drawGithub(c, live);
    }
    dotLayer.innerHTML = dots(cycle.pages.length, cycle.index);
    const entries = key === "stock" ? stocks : key === "coin" ? coins : [];
    if (entries.length >= 2) {
      const shown = sub[key] % entries.length;
      for (let i = 0; i < entries.length; i++) {
        const cy = subDotY(i, entries.length, SCREEN_H);
        dotLayer.innerHTML += i === shown
          ? `<circle cx="${SCREEN_W - 8}" cy="${cy}" r="3" fill="${FG}"/>`
          : `<circle cx="${SCREEN_W - 8}" cy="${cy}" r="2" fill="none" stroke="${DOT_OFF}" stroke-width="1.25"/>`;
      }
    }

    let text = S.pageNames[key];
    const shownTicker = tickerOf(config, entry);
    if (key === "stock" && shownTicker) text += ` · ${shownTicker}`;
    if (key === "coin" && coinEntry) text += ` · ${String(coinEntry.pair).toUpperCase()}`;
    if (key === "github") text += ` · ${config.github_user}`;
    const sample = (key === "weather")
      || (key === "stock" && !isNum(priceOf(live, shownTicker)))
      || (key === "github" && !isNum(live.followers))
      || (key === "coin" && coinEntry && !coinIsLive(coinEntry, live));
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

  // Like a tap on the Buddy: the next entry on a stock or coin page with
  // several; after the last one, the next page.
  const next = () => {
    const key = cycle.page;
    const count = key === "stock" ? activeStocks(config).length : key === "coin" ? usableCoins(config).length : 0;
    if (count < 2) { cycle.next(); return; }
    const step = clickStep(sub[key] % count, count);
    sub[key] = step.index;
    if (step.nextPage) { cycle.next(); return; }
    cycle.endHold(); cycle.schedule(); draw();
  };
  button.addEventListener("click", next);
  const togglePause = () => { cycle.setPaused(!cycle.paused); syncPause(); };
  pause.addEventListener("click", togglePause);
  const onMotion = () => { cycle.schedule(); draw(); syncPause(); };
  if (mq) mq.addEventListener("change", onMotion);

  function update(nextConfig, nextLive) {
    config = nextConfig || DEFAULT_CONFIG;
    live = nextLive || {};
    sub.stock = Math.min(sub.stock, Math.max(0, activeStocks(config).length - 1));
    sub.coin = Math.min(sub.coin, Math.max(0, usableCoins(config).length - 1));
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
    // Show the stock or coin at slot `slot` of config.stocks / config.coins (a Check in the form) and hold the page.
    showEntry(pageKey, slot, holdMs = HOLD_MS) {
      const list = pageKey === "stock" ? activeStocks(config) : pageKey === "coin" ? usableCoins(config) : [];
      const at = list.findIndex((e) => e.slot === slot);
      if (at >= 0) sub[pageKey] = at;
      const shown = cycle.showPage(pageKey, holdMs);
      draw();
      return shown;
    },
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
