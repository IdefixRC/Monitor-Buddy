import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { S } from "../web/js/strings.js";
import { parseRich } from "../web/js/form.js";
import { NotABuddy, FlashError } from "../web/js/flasher.js";
import { fakeDevice } from "../web/js/fake-buddy.js";

const plain = (text) => parseRich(text).map((t) => t.text).join("");
const links = (text) => parseRich(text).filter((t) => t.type === "link").map((t) => t.href);
const NOTE = "https://github.com/IdefixRC/Monitor-Buddy#2-what-you-need";

test("an ESP32-C6 without the parts gets Eric's wording, linking the touchscreen note", () => {
  assert.equal(plain(S.notBuddy.parts),
    "I'm sorry but this does not seem to be a Monitor Buddy board. I found an ESP32-C6, but not the "
    + "touchscreen and motion sensor of the Waveshare ESP32-C6-Touch-LCD-1.47. Please check the documentation "
    + "and ensure you have the correct device. Nothing was written to it.");
  assert.deepEqual(links(S.notBuddy.parts), [NOTE]);
});

test("another board gets Eric's wording, linking the touchscreen note", () => {
  assert.equal(plain(S.notBuddy.chip),
    "I'm sorry, no Monitor Buddy compatible board was found. Please ensure you connect a Waveshare "
    + "ESP32-C6-Touch-LCD-1.47. Please check the link in the documentation for the correct device. "
    + "Nothing was written.");
  assert.deepEqual(links(S.notBuddy.chip), [NOTE]);
});

test("Start says what to do when the Buddy isn't in the list", () => {
  assert.match(plain(S.start.notListed), /^Not in the list\?.*ESP32-C6-Touch-LCD-1\.47/);
  assert.deepEqual(links(S.start.notListed), [NOTE]);
});

const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");

test("a refused flash shows the matching screen, not the replug advice", () => {
  const writeImage = app.slice(app.indexOf("async function writeImage("), app.indexOf("async function afterFlash("));
  const refused = writeImage.indexOf("e.cause instanceof NotABuddy");
  assert.ok(refused >= 0, "writeImage doesn't handle NotABuddy");
  assert.ok(refused < writeImage.indexOf("S.flash.replug"), "the replug screen comes first");
  assert.match(writeImage, /e\.cause instanceof NotABuddy\) return showNotBuddy\(e\.cause\.kind\)/);
});

test("a board that doesn't answer INFO is checked before path B is offered", () => {
  const route = app.slice(app.indexOf("async function probeAndRouteOnce("), app.indexOf("async function checkThenPathB("));
  assert.ok(route.length > 500, "probeAndRouteOnce not found before checkThenPathB");
  assert.doesNotMatch(route, /showPathB\(\)/, "path B is shown without the check");
  assert.equal((route.match(/checkThenPathB\(\)/g) || []).length, 2, "both ways into path B go through the check");
  const check = app.slice(app.indexOf("async function checkThenPathB("));
  assert.match(check.slice(0, 1500), /dev\.checkBuddy\(port,[\s\S]*showNotBuddy\(e\.cause\.kind\)[\s\S]*showPathB\(\)/);
});

test("both refusal screens use the sad face", () => {
  const show = app.slice(app.indexOf("function showNotBuddy("));
  assert.match(show.slice(0, 600), /mood: "sad", say: kind === "chip" \? S\.notBuddy\.chip : S\.notBuddy\.parts/);
});

// The simulated boards for checking the screens: ?fake=c and ?fake=d.
const fake = (q) => fakeDevice(new URLSearchParams(q));
const refusedAs = (kind) => (e) => e instanceof FlashError && e.cause instanceof NotABuddy && e.cause.kind === kind;
const image = new Uint8Array(16);

test("?fake=c is an ESP32-C6 without the parts: refused at the check and at the flash", async () => {
  const d = fake("fake=c");
  await assert.rejects(d.checkBuddy({}), refusedAs("parts"));
  let wrote = false;
  await assert.rejects(d.flashImage({}, image, { onStage: (s) => { if (s === "erase" || s === "write") wrote = true; } }),
    refusedAs("parts"));
  assert.equal(wrote, false);
});

test("?fake=d is another ESP32: refused as 'chip'", async () => {
  await assert.rejects(fake("fake=d").checkBuddy({}), refusedAs("chip"));
});

test("?fake=b, a Buddy without the firmware, passes the check", async () => {
  await fake("fake=b").checkBuddy({});
});

// ── Only the board that was picked (COM7 and COM12, 2026-10-17) ──

const fn = (name, len = 2000) => app.slice(app.indexOf(name)).slice(0, len);

test("path B keeps the MAC the board check read", () => {
  assert.match(fn("async function checkThenPathB("), /const \{ mac \} = await dev\.checkBuddy\(port,[\s\S]*app\.bp\.mac = mac/);
});

test("a check that can't reach the board asks for it to be picked again", () => {
  assert.match(fn("async function checkThenPathB("),
    /return showProblem\(S\.connecting\.checkFailed, null, \{ retry: connect, retryLabel: S\.connecting\.pickAgain \}\)/);
  assert.ok(S.connecting.checkFailed && S.connecting.pickAgain);
});

test("an INFO from another board than the one checked is refused", () => {
  assert.match(fn("async function probeAndRouteOnce(", 3000),
    /info && bp\.mac && info\.mac && !sameMac\(info\.mac, bp\.mac\)\) return showProblem\(S\.flash\.wrongBoard/);
});

test("connect stops listening the moment a boot loop shows", () => {
  assert.match(fn("async function probeAndRouteOnce(", 3000), /app\.trouble = await watchForTrouble\(app\.rx\.recent, LISTEN_MS\)/);
});

test("the simulated boards report a MAC from the check", async () => {
  assert.match((await fake("fake=b").checkBuddy({})).mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
});
