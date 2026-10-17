import { test } from "node:test";
import assert from "node:assert/strict";
import { PREFIX, MAX_ID, makeIdSource, requestLine, LineSplitter, parseReply, answers, romTrouble, watchForTrouble, sameMac } from "../web/js/protocol.js";

test("ids start at the given value, increase and wrap", () => {
  const next = makeIdSource(MAX_ID - 1);
  assert.equal(next(), MAX_ID - 1);
  assert.equal(next(), MAX_ID);
  assert.equal(next(), 0);
});

test("request line puts id first and drops a body id", () => {
  assert.equal(requestLine("INFO", 7), '@MB INFO {"id":7}\n');
  assert.equal(requestLine("SET", 8, { id: 99, config: { ticker: "AVGO" } }),
               '@MB SET {"id":8,"config":{"ticker":"AVGO"}}\n');
});

test("line splitter keeps partial lines and strips CR", () => {
  const s = new LineSplitter();
  assert.deepEqual(s.push("app=0 mo"), []);
  assert.deepEqual(s.push("od=0\r\n@MB {\"ok\":true}\npart"), ["app=0 mood=0", '@MB {"ok":true}']);
  assert.deepEqual(s.push("ial\n"), ["partial"]);
});

test("parseReply accepts only prefixed JSON objects", () => {
  assert.deepEqual(parseReply('@MB {"ok":true,"cmd":"GET","id":3}'), { ok: true, cmd: "GET", id: 3 });
  assert.equal(parseReply("app=0 mood=0 wifi=up"), null);
  assert.equal(parseReply("@MB {broken"), null);
  assert.equal(parseReply("@MB [1,2]"), null);
  assert.equal(parseReply('xx@MB {"ok":true}'), null);
  assert.equal(PREFIX, "@MB ");
});

test("answers matches cmd and id, plus the three id-less errors", () => {
  assert.ok(answers({ ok: true, cmd: "GET", id: 5 }, "GET", 5));
  assert.ok(!answers({ ok: true, cmd: "GET", id: 4 }, "GET", 5));          // stale
  assert.ok(!answers({ ok: true, cmd: "INFO", id: 5 }, "GET", 5));         // wrong command
  for (const error of ["line too long", "bad json", "restarting"])
    assert.ok(answers({ ok: false, cmd: "SET", error }, "SET", 5), error);
  assert.ok(!answers({ ok: false, cmd: "SET", error: "unknown command" }, "SET", 5));
  assert.ok(!answers({ ok: false, cmd: "SET", id: 4, error: "restarting" }, "SET", 5));
});

// ── What the port says before we write anything (E2, 2026-10-12) ─
// Captured on COM12: a boot loop after a cut-off flash, the same after an
// erased app header, and a Buddy that runs.

const ROM = [
  "ESP-ROM:esp32c6-20220919", "Build:Sep 19 2022",
  "rst:0x3 (LP_SW_HPSYS),boot:0x2b (SPI_FAST_FLASH_BOOT)", "Saved PC:0x4001974a", "SPIWP:0xee",
  "mode:DIO, clock div:2", "load:0x40875730,len:0x117c", "entry 0x4086b910",
];
const CUT_OFF = [...ROM, "E (80) esp_image: invalid segment length 0xffffffff",
  "E (80) boot: OTA app partition slot 0 is not bootable", "E (81) boot: No bootable app partitions in the partition table"];
const ERASED = [...ROM, "E (23) esp_image: image at 0x10000 has invalid magic byte (nothing flashed here?)",
  "E (24) boot: OTA app partition slot 0 is not bootable"];
const RUNNING = ["app=4 mood=0 wifi=up up=40s rst=11", "app=4 mood=0 wifi=up up=42s rst=11"];

test("a boot loop is recognised before anything is written", () => {
  assert.equal(romTrouble(CUT_OFF), "bootloop");
  assert.equal(romTrouble(ERASED), "bootloop");
  assert.equal(romTrouble(["E (24) boot: No bootable app partitions in the partition table"]), "bootloop");
});

test("ROM banners repeating without an error line still mean a boot loop", () => {
  assert.equal(romTrouble([...ROM, ...ROM]), "bootloop");
});

test("one clean boot, or a running Buddy, is no trouble", () => {
  // A Buddy that was just plugged in prints the ROM banner exactly once.
  assert.equal(romTrouble([...ROM.map((l) => l.replace("rst:0x3 (LP_SW_HPSYS)", "rst:0x1 (POWERON)")),
    "ESP32-C6 Monitor-Buddy 1.2.0-rc2 starting"]), null);
  assert.equal(romTrouble(RUNNING), null);
  assert.equal(romTrouble([]), null);
});

test("blank flash (the ROM finds no bootloader) is a boot loop", () => {
  // COM7, an ESP32-C3 with blank flash, 2026-10-17: only this line, hundreds a
  // second, then a watchdog restart every 1-3 s that drops it off USB. The ROM
  // banner comes before the port can be opened, so this line is all there is.
  assert.equal(romTrouble(["invalid header: 0xffffffff", "invalid header: 0xffffffff"]), "bootloop");
  // The first line, cut off by opening mid-stream, doesn't count on its own.
  assert.equal(romTrouble(["ader: 0xffffffff", "invalid header: 0xffffffff"]), "bootloop");
});

test("a board already in download mode is recognised", () => {
  assert.equal(romTrouble(["rst:0x1 (POWERON),boot:0x1f (DOWNLOAD(USB/UART0/SDIO_FEI_FEO))", "waiting for download"]), "download");
});

// ── Which Buddy is this? (review, 2026-10-13) ─────────────
// INFO reports the base MAC; esptool may print it as an EUI-64 (ff:fe in the middle).

test("sameMac() matches the base MAC in either form, and nothing else", () => {
  assert.equal(sameMac("b0:a6:04:8b:03:f0", "B0:A6:04:8B:03:F0"), true);
  assert.equal(sameMac("b0:a6:04:ff:fe:8b:03:f0", "b0:a6:04:8b:03:f0"), true);
  assert.equal(sameMac("b0a6048b03f0", "b0:a6:04:8b:03:f0"), true);
  assert.equal(sameMac("58:8c:81:5a:33:fc", "b0:a6:04:8b:03:f0"), false);
  assert.equal(sameMac("", "b0:a6:04:8b:03:f0"), false);
  assert.equal(sameMac(undefined, undefined), false);
});

// A board in a boot loop must get esptool before its next USB drop (COM7: every
// 1-3 s), so the listen ends the moment the trouble shows instead of after 500 ms.
test("watchForTrouble() returns as soon as a boot loop shows", async () => {
  const lines = [];
  setTimeout(() => lines.push("invalid header: 0xffffffff"), 20);
  const t0 = Date.now();
  assert.equal(await watchForTrouble(lines, 2000, { step: 5 }), "bootloop");
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
});

test("watchForTrouble() listens the full time when nothing is wrong", async () => {
  const t0 = Date.now();
  assert.equal(await watchForTrouble(["app=4 mood=0 wifi=up up=40s rst=11"], 60, { step: 5 }), null);
  assert.ok(Date.now() - t0 >= 55);
});
