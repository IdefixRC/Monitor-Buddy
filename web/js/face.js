// The Buddy's face, drawn as SVG on the device's 320x172 screen.
//
// A port of the firmware's face in src/main.cpp: the Eye struct and its springs,
// updateFacePhysics (blink, saccades, breathing, per-mood eye sizes), drawFace
// (emotion particles, blush), drawEyeShape (sclera, pupil, glints, heart pupils,
// sparkle) and drawEyelidMask. Coordinates, sizes and colours are the firmware's
// own; KEEP IN SYNC with src/main.cpp so the browser shows the same Buddy.
//
// Web differences: the gaze follows the pointer instead of the IMU tilt, there
// is a web-only "curious" mood, and prefers-reduced-motion turns all movement off.

import { S } from "./strings.js";

const NS = "http://www.w3.org/2000/svg";
export const SCREEN_W = 320;
export const SCREEN_H = 172;

const FG = "#ffffff";
const BG = "#000000";
const ANGRY_RED = "#ff505a"; // rgb(255, 80, 90)
const GOLD = "#ffd23c";      // rgb(255, 210, 60)
const BLUSH = "#ff7896";     // rgb(255, 120, 150)

// Eye centres (FACE_LEFT_CX, FACE_RIGHT_CX, FACE_EYES_CY).
const LEFT_CX = 105;
const RIGHT_CX = 215;
const EYES_CY = 80;

// Spring constants from struct Eye.
export const SPRING = { k: 0.12, d: 0.60, pk: 0.08, pd: 0.50 };

// The springs are per frame. The firmware's loop is delay(24) plus drawing and
// the SPI flush, about 30 frames a second, so the browser steps at that rate
// whatever its own frame rate is.
export const STEP_MS = 33;

// Moods the flasher uses, and the firmware's other three, which setMood also takes.
export const MOODS = ["normal", "curious", "suspicious", "excited", "sad", "love", "happy"];
const ALL_MOODS = new Set([...MOODS, "surprised", "sleepy", "angry"]);

// Emotion bitmaps, 1 bit per pixel, rows MSB first (bmp_heart, bmp_zzz,
// bmp_anger and bmp_github in src/main.cpp), as hex.
export const BITMAPS = {
  heart: { w: 16, h: 16, hex: "00000c601ef03ff87ffc7ffc7ffc3ff81ff00fe007c003800100000000000000" },
  zzz: { w: 16, h: 16, hex: "000000000000003c000c00180030007e00003c000c00180030007c0000000000" },
  anger: { w: 16, h: 16, hex: "000011102a9044408020802044402a9011100000000000000000000000000000" },
  github: {
    w: 56, h: 56,
    hex: "000001ff80000000001ffff800000000ffffff00000003ffffffc0000007ffffffe000001ffffffff800003ffffffffc00007ffffffffe0000ffffffffff0001ffffffffff8003ffffffffffc007ffffffffffe007f83ffffc1fe00ff80ffff81ff01ff80000000ff81ff80000000ff83ff80000000ffc3ff80000001ffc3ff80000001ffc7ff80000001ffe7ff00000000ffe7fe000000007fe7fe000000007feffe000000003ffffc000000003ffffc000000003ffffc000000003ffffc000000003ffffc000000003ffffc000000003ffffe000000003ffffe000000007ffffe000000007ff7fe000000007fe7ff00000000ffe7ff80000001ffe7ffc0000001ffe3ffe0000007ffc3fff000000fffc3f1fe00007fffc1f0ffc003ffff81fc7fc003ffff80fc7fc001ffff007e3f8001fffe007f0f0001fffe003f000001fffc001f800001fff8000fc00001fff00007ff8001ffe00003ff8001ffc00001ff8001ff8000007f8001fe0000003f8001fc0000000f8001f00000000100008000000000000000000",
  },
};

// SVG path data for a bitmap, one unit per pixel, horizontal runs merged.
// Scale and place it with a transform, as drawBitmapScaled does.
export function bitmapPath({ w, h, hex }) {
  const bytesPerRow = Math.ceil(w / 8);
  const on = (row, col) => {
    const i = (row * bytesPerRow + (col >> 3)) * 2;
    return (parseInt(hex.slice(i, i + 2), 16) & (0x80 >> (col & 7))) !== 0;
  };
  let d = "";
  for (let row = 0; row < h; row++) {
    let col = 0;
    while (col < w) {
      if (!on(row, col)) { col++; continue; }
      const start = col;
      while (col < w && on(row, col)) col++;
      d += `M${start} ${row}h${col - start}v1h${start - col}z`;
    }
  }
  return d;
}

// One damped spring, as in Eye::update.
export function springStep(s, k, d) {
  s.vel = (s.vel + (s.t - s.v) * k) * d;
  s.v += s.vel;
}

// Per-mood eye sizes and pupil nudges, from the switch in updateFacePhysics.
// rand(lo, hi) returns an integer lo..hi-1, like Arduino's random(). Returns
// { left: {w, h, dpx, dpy}, right: {...} }; w is null while blinking (the width
// target is left unchanged, as in the firmware).
export function eyeTargets(mood, breath, blinking, rand = () => 0) {
  const both = (w, h, dpx = 0, dpy = 0) => ({ left: { w, h, dpx, dpy }, right: { w, h, dpx, dpy } });
  if (blinking) return both(null, 4);                                   // slam shut
  switch (mood) {
    case "happy": return both(92, 92, 0, -6);                           // gaze slightly up
    case "love": return both(96, 96);
    case "surprised": {
      const t = both(75, 112);
      t.left.dpx = rand(-3, 4); t.right.dpx = rand(-3, 4);              // jitter
      return t;
    }
    case "sleepy": return both(95, 75);
    case "angry": return both(85, 80);
    case "sad": return both(85, 100);
    case "excited": {
      const t = both(90, 106 + breath);
      t.left.dpy = rand(-2, 3); t.right.dpy = rand(-2, 3);
      return t;
    }
    case "suspicious":
      return { left: { w: 90, h: 50, dpx: 0, dpy: 0 }, right: { w: 90, h: 105, dpx: 0, dpy: 0 } };
    case "curious":
      // Web only: the mirror of suspicious with a softer, slanted squint on the
      // right eye and the gaze lifted, so it reads as interested, not wary.
      return { left: { w: 90, h: 100, dpx: 4, dpy: -8 }, right: { w: 90, h: 70, dpx: 4, dpy: -8 } };
    default: return both(90, 90 + breath);                              // normal
  }
}

// The black eyelid shape for a mood as a polygon point list (drawEyelidMask),
// or "" for none. ix/iy are the eye's top-left corner.
export function eyelidPoints(mood, ix, iy, iw, ih, isLeft) {
  const slant = iw * 0.167;
  const band = ih * 0.44;
  const f = (n) => +n.toFixed(2);
  // Top edge from (ix, yl) to (ix+iw, yr), b thick. The mask runs 1 unit past
  // the eye on every open side: on a pixel screen it ends exactly at the edge,
  // but anti-aliased SVG would leave a faint white seam there.
  const x0 = ix - 1;
  const x1 = ix + iw + 1;
  const quad = (yl, yr, b) =>
    `${f(x0)},${f(yl)} ${f(x1)},${f(yr)} ${f(x1)},${f(yr + b)} ${f(x0)},${f(yl + b)}`;
  const rect = (y, h) => quad(y, y, h);
  switch (mood) {
    case "angry": // lids lowered towards the nose (a frown): inner side is ix + iw on the left eye
      return isLeft ? quad(iy - slant, iy, band) : quad(iy, iy - slant, band);
    case "sad":   // lids lowered at the outer corners (a droop)
      return isLeft ? quad(iy, iy - slant, band) : quad(iy - slant, iy, band);
    case "sleepy":
      return rect(iy - 1, ih / 2 + 6);
    case "suspicious": // one squint, one wide with a lower lid
      return isLeft ? rect(iy - 1, ih / 2 - 4) : rect(iy + ih - ih * 0.22, ih * 0.22 + 1);
    case "curious": {
      // Web only: one lid lowered, drooping towards the outer corner.
      if (isLeft) return "";
      const top = iy - 2;
      return `${f(x0)},${f(top)} ${f(x1)},${f(top)} ${f(x1)},${f(iy + ih * 0.42)} ${f(x0)},${f(iy + ih * 0.2)}`;
    }
    default:
      return "";
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function set(e, attrs) {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === "number" ? +v.toFixed(2) : v);
}

function show(e, on) {
  if (on) e.removeAttribute("display");
  else e.setAttribute("display", "none");
}

const HEART_D = bitmapPath(BITMAPS.heart);
const ZZZ_D = bitmapPath(BITMAPS.zzz);
const ANGER_D = bitmapPath(BITMAPS.anger);

function makeEye(cx, parent) {
  const spring = (v) => ({ v, t: v, vel: 0 });
  const g = el("g", {}, parent);
  return {
    x: spring(cx), y: spring(EYES_CY), w: spring(90), h: spring(90),
    px: spring(0), py: spring(0),
    sclera: el("rect", {}, g),
    pupil: el("rect", { fill: BG }, g),
    heart: el("path", { d: HEART_D, fill: BG, "shape-rendering": "crispEdges" }, g),
    glint1: el("circle", { r: 5 }, g),
    glint2: el("circle", { r: 3 }, g),
    sparkle: el("path", { fill: GOLD }, g),
    lid: el("polygon", { fill: BG }, g),
  };
}

// The face. container is an HTML element (the face fills its width) or an SVG
// element (the face is placed at its origin, 320x172 user units, as the
// preview does). Returns { setMood(mood), lookAt(x, y), destroy() }.
// lookAt takes a direction from -1 to 1 on each axis, like the firmware's tilt;
// lookAt(null) hands the gaze back to the pointer.
export function createFace(container) {
  const inSvg = container instanceof SVGElement;
  // Nested in the preview it gets its own class: .buddy-face sizes a page-level face.
  const svg = el("svg", { viewBox: `0 0 ${SCREEN_W} ${SCREEN_H}`, class: inSvg ? "buddy-preview__face" : "buddy-face" });
  if (inSvg) {
    set(svg, { width: SCREEN_W, height: SCREEN_H, "aria-hidden": "true" });
  } else {
    set(svg, { role: "img", "aria-label": S.faceLabel });
  }
  el("rect", { width: SCREEN_W, height: SCREEN_H, rx: inSvg ? 0 : 14, fill: BG }, svg);

  // Emotion particles (drawFace), drawn before the eyes like the firmware does.
  const particles = el("g", { fill: FG, "shape-rendering": "crispEdges" }, svg);
  const heartL = el("path", { d: HEART_D, transform: "translate(18 8) scale(2)" }, particles);
  const heartR = el("path", { d: HEART_D, transform: "translate(270 8) scale(2)" }, particles);
  const zzz = el("path", { d: ZZZ_D, transform: "translate(144 6) scale(2)" }, particles);
  const anger = el("path", { d: ANGER_D, transform: "translate(144 8) scale(2)" }, particles);

  const left = makeEye(LEFT_CX, svg);
  const right = makeEye(RIGHT_CX, svg);
  const blush = el("g", { fill: BLUSH }, svg);
  el("circle", { cx: 70, cy: 126, r: 13 }, blush);
  el("circle", { cx: 250, cy: 126, r: 13 }, blush);
  container.appendChild(svg);

  let mood = "normal";
  let override = null;        // lookAt() direction
  let pointer = null;         // last pointer position, client coordinates
  let pointerAt = -Infinity;  // when the pointer last moved
  let reduced = false;
  let raf = 0;
  let clock = 0;              // simulated ms, advanced in STEP_MS steps
  let lastFrame = 0;
  let pending = 0;

  // Timers from updateFacePhysics. Blink every 1-4 s (the brief's range; the
  // firmware waits 1-4 s for the first blink and 2-6 s after that).
  let blinking = false;
  let lastBlink = 0;
  let nextBlink = randInt(1000, 4000);
  let lastSaccade = 0;
  let saccadeInterval = 3000;
  let gazeX = 0;
  let gazeY = 0;

  // The pointer's direction from the eyes, -1..1, in the face's own
  // coordinates. getScreenCTM includes any rotation of a parent (the preview
  // turns the screen 180 degrees for a right-side mount), so the eyes always
  // look at the pointer, as tiltSign makes them follow the board.
  function pointerTilt() {
    if (!pointer) return null;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(pointer.x, pointer.y).matrixTransform(m.inverse());
    const dx = p.x - SCREEN_W / 2;
    const dy = p.y - EYES_CY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return { x: 0, y: 0 };
    const reach = dist / (dist + 140); // soft limit: 0 near the eyes, towards 1 far away
    return { x: (dx / dist) * reach, y: (dy / dist) * reach };
  }

  // One firmware frame of updateFacePhysics.
  function step(now, settle) {
    const breath = settle ? 0 : Math.sin(now / 800) * 3.5;

    if (!settle) {
      if (now > nextBlink) {
        blinking = true;
        lastBlink = now;
        nextBlink = now + randInt(1000, 4000);
      }
      if (blinking && now - lastBlink > 120) blinking = false;
    } else {
      blinking = false;
    }

    let tilt = override;
    const following = !settle && !override && pointer && now - pointerAt < 3000;
    if (!tilt && !settle) tilt = pointerTilt();
    if (!tilt) {
      // No pointer: the firmware's no-IMU drift, so the Buddy never freezes.
      tilt = settle ? { x: 0, y: 0 }
        : { x: Math.sin(now * 0.0014) * 0.25, y: Math.cos(now * 0.0011) * 0.16 };
    }

    // Saccades only while nobody is steering the gaze.
    if (settle || following || override) {
      gazeX = 0; gazeY = 0;
    } else if (!blinking && now - lastSaccade > saccadeInterval) {
      lastSaccade = now;
      saccadeInterval = randInt(500, 3000);
      const dir = randInt(0, 10);
      [gazeX, gazeY] = dir < 4 ? [0, 0] : [[-15, -10], [15, -10], [-15, 10], [15, 10], [20, 0], [-20, 0]][dir - 4];
    }

    const pupX = gazeX + tilt.x * 20;
    const pupY = gazeY + tilt.y * 12;
    const eyeDX = gazeX * 0.3 + tilt.x * 8;
    const eyeY = EYES_CY + gazeY * 0.3 + tilt.y * 6;
    const t = eyeTargets(mood, breath, blinking, settle ? () => 0 : randInt);
    for (const [eye, cx, tt] of [[left, LEFT_CX, t.left], [right, RIGHT_CX, t.right]]) {
      eye.x.t = cx + eyeDX;
      eye.y.t = eyeY;
      if (tt.w !== null) eye.w.t = tt.w;
      eye.h.t = tt.h;
      eye.px.t = pupX + tt.dpx;
      eye.py.t = pupY + tt.dpy;
      for (const s of [eye.x, eye.y, eye.w, eye.h]) {
        if (settle) { s.v = s.t; s.vel = 0; } else springStep(s, SPRING.k, SPRING.d);
      }
      for (const s of [eye.px, eye.py]) {
        if (settle) { s.v = s.t; s.vel = 0; } else springStep(s, SPRING.pk, SPRING.pd);
      }
    }
  }

  // drawEyeShape + drawEyelidMask.
  function drawEye(eye, isLeft) {
    const iw = eye.w.v;
    const ih = eye.h.v;
    const parts = [eye.sclera, eye.pupil, eye.heart, eye.glint1, eye.glint2, eye.sparkle, eye.lid];
    if (iw < 2 || ih < 2) { parts.forEach((p) => show(p, false)); return; }
    const ix = eye.x.v - iw / 2;
    const iy = eye.y.v - ih / 2;
    const r = iw < 50 ? 6 : 16;
    const cx = ix + iw / 2;
    const cy = iy + ih / 2;

    show(eye.sclera, true);
    set(eye.sclera, { x: ix, y: iy, width: iw, height: ih, rx: r, fill: mood === "angry" ? ANGRY_RED : FG });

    const big = mood === "excited";
    const pw = iw / (big ? 1.85 : 2.2);
    const ph = ih / (big ? 1.85 : 2.2);
    const px = clamp(cx + eye.px.v - pw / 2, ix, ix + iw - pw);
    const py = clamp(cy + eye.py.v - ph / 2, iy, iy + ih - ph);

    if (mood === "love") {
      // Heart-shaped pupil, the 16x16 heart at the pupil's scale.
      const scale = clamp(Math.floor(pw / 6), 2, 4);
      const hw = 16 * scale;
      const hx = clamp(cx + eye.px.v - hw / 2, ix, ix + iw - hw);
      const hy = clamp(cy + eye.py.v - hw / 2, iy, iy + ih - hw);
      show(eye.pupil, false);
      show(eye.heart, true);
      set(eye.heart, { transform: `translate(${hx.toFixed(2)} ${hy.toFixed(2)}) scale(${scale})` });
    } else {
      show(eye.heart, false);
      show(eye.pupil, true);
      set(eye.pupil, { x: px, y: py, width: pw, height: ph, rx: r / 2 });
    }

    const twin = mood === "happy" || big;
    const glintOn = mood !== "love" && (twin || (iw > 30 && ih > 30));
    show(eye.glint1, glintOn);
    show(eye.glint2, glintOn && twin);
    if (glintOn) {
      const c = big ? GOLD : FG;
      set(eye.glint1, { cx: px + pw - 10, cy: py + 10, fill: c });
      set(eye.glint2, { cx: px + 9, cy: py + ph - 11, fill: c });
    }

    show(eye.sparkle, big);
    if (big) {
      const sx = isLeft ? ix - 2 : ix + iw + 2; // on the outer side
      const sy = iy + 2;
      set(eye.sparkle, { d: `M${(sx - 7).toFixed(1)} ${(sy - 1).toFixed(1)}h15v3h-15zM${(sx - 1).toFixed(1)} ${(sy - 7).toFixed(1)}h3v15h-3z` });
    }

    // Happy and excited return before the mask in the firmware; love has none.
    const pts = twin ? "" : eyelidPoints(mood, ix, iy, iw, ih, isLeft);
    show(eye.lid, pts !== "");
    if (pts) set(eye.lid, { points: pts });
  }

  function render() {
    show(heartL, mood === "love");
    show(heartR, mood === "love");
    show(zzz, mood === "sleepy");
    show(anger, mood === "angry");
    drawEye(left, true);
    drawEye(right, false);
    show(blush, mood === "happy");
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    pending += Math.min(t - lastFrame, 250); // no catch-up storm after a hidden tab
    lastFrame = t;
    let stepped = false;
    while (pending >= STEP_MS) {
      clock += STEP_MS;
      pending -= STEP_MS;
      step(clock, false);
      stepped = true;
    }
    if (stepped) render();
  }

  function settleNow() {
    step(clock, true);
    render();
  }

  function start() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (reduced) { settleNow(); return; }
    lastFrame = performance.now();
    pending = 0;
    raf = requestAnimationFrame(frame);
  }

  const onMove = (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    pointerAt = clock;
  };
  const onOut = (e) => { if (!e.relatedTarget) pointer = null; };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onMove, { passive: true });
  document.addEventListener("pointerout", onOut, { passive: true });

  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const onMotion = () => { reduced = !!(mq && mq.matches); start(); };
  if (mq) mq.addEventListener("change", onMotion);
  settleNow(); // first paint already in place, no flash of a default face
  onMotion();

  return {
    setMood(next) {
      mood = ALL_MOODS.has(next) ? next : "normal";
      if (reduced) settleNow();
    },
    lookAt(x, y) {
      override = x === null || x === undefined ? null
        : { x: clamp(+x || 0, -1, 1), y: clamp(+y || 0, -1, 1) };
      if (reduced) settleNow();
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerout", onOut);
      if (mq) mq.removeEventListener("change", onMotion);
      svg.remove();
    },
  };
}
