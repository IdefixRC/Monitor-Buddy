// Download, verify and flash a firmware image with the vendored esptool-js.
import { ESPLoader, Transport } from "../vendor/esptool-js/bundle.js";
import { sameMac } from "./protocol.js";
import { BUDDY_CHIP, checkBoard } from "./boardcheck.js";

// The chip esptool reached isn't the Buddy the page was talking to.
export class WrongBoard extends Error {
  constructor(message) {
    super(message);
    this.name = "WrongBoard";
  }
}

// Not a Monitor Buddy board. kind "chip": another chip than the ESP32-C6;
// kind "parts": an ESP32-C6 without the Buddy's touch screen and motion sensor.
export class NotABuddy extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "NotABuddy";
    this.kind = kind;
  }
}

export class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadError";
  }
}

export class ImageMismatch extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageMismatch";
  }
}

// stage: "connect", "erase", "write" or "reset". `cause` is the original error.
export class FlashError extends Error {
  constructor(stage, cause) {
    super(`${stage}: ${cause && cause.message ? cause.message : cause}`);
    this.name = "FlashError";
    this.stage = stage;
    this.cause = cause;
  }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// entry: one element of releases.json's "releases" ({ file, size, sha256, ... }).
// siteRoot: the URL the entry's relative `file` is resolved against.
// onStage("check") is called once the download is complete.
export async function fetchImage(entry, siteRoot, { onStage } = {}) {
  const url = new URL(entry.file, siteRoot);
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new DownloadError(`could not download ${url.pathname}: ${e.message}`);
  }
  if (!response.ok) throw new DownloadError(`could not download ${url.pathname}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (onStage) onStage("check");
  if (data.length !== entry.size) {
    throw new ImageMismatch(`the image is ${data.length} bytes, expected ${entry.size}`);
  }
  const digest = hex(await crypto.subtle.digest("SHA-256", data));
  if (digest !== String(entry.sha256).toLowerCase()) {
    throw new ImageMismatch("the image's SHA-256 does not match the release list");
  }
  return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Restarts the Buddy after flashing. We pulse EN ourselves instead of calling
// esptool-js's after("hard_reset"): its HardReset only releases RTS and never
// pulses it, so on the ESP32-C6's USB-Serial-JTAG the chip stayed in the ROM
// download mode and the Buddy never started (measured 2026-10-11).
// RTS high holds EN low (reset); DTR stays low so IO9 is high (normal boot).
export async function resetToFirmware(port) {
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  await sleep(100);
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
}

// Throws NotABuddy unless the chip esptool reached is an ESP32-C6 on a
// Buddy board (boardcheck.js). Reads and toggles two GPIOs, writes no flash.
export async function checkIsBuddy(loader, say = () => {}) {
  const chip = loader.chip.CHIP_NAME;
  if (chip !== BUDDY_CHIP) throw new NotABuddy("chip", `the chip is ${chip}, not ${BUDDY_CHIP}`);
  const r = await checkBoard({ read: (a) => loader.readReg(a), write: (a, v) => loader.writeReg(a, v) });
  say(`Board check: ${r.detail}`);
  if (!r.ok) throw new NotABuddy("parts", r.detail);
}

// esptool-js on a CLOSED port; loader.main() then puts the chip in install mode.
function makeLoader(serialPort, say) {
  const terminal = { clean() {}, write: say, writeLine: say };
  const transport = new Transport(serialPort);
  const loader = new ESPLoader({ transport, baudrate: 115200, terminal });
  return { transport, loader };
}

// A board that was refused before anything was written goes back to its own
// firmware instead of staying in install mode. Best effort.
async function restartRefused(transport, serialPort) {
  try { await resetToFirmware(transport.device ?? serialPort); } catch { /* the port is gone */ }
}

// Connects, checks the board (checkIsBuddy) and restarts it into its own
// firmware. Writes nothing. `serialPort` must be CLOSED, as for flashImage.
// Resolves { mac }, the chip's MAC, so later steps accept only this board.
// Throws FlashError("connect", cause); cause is NotABuddy for a refused board.
export async function checkBuddy(serialPort, { log, resetMode = "default_reset" } = {}) {
  const say = (text) => { if (log) log(String(text)); };
  let transport = null;
  let mac;
  try {
    let loader;
    ({ transport, loader } = makeLoader(serialPort, say));
    await loader.main(resetMode);
    await checkIsBuddy(loader, say);
    mac = await loader.chip.readMac(loader);
    say("Restarting the board");
    await resetToFirmware(transport.device ?? serialPort);
  } catch (e) {
    if (transport && e instanceof NotABuddy) await restartRefused(transport, serialPort);
    if (transport) { try { await transport.disconnect(); } catch { /* leave the port as it is */ } }
    throw new FlashError("connect", e);
  }
  try { await transport.disconnect(); } catch { /* it re-enumerates after the restart */ }
  return { mac };
}

// Writes `image` at address 0. `serialPort` must be CLOSED: esptool-js opens
// it itself (so close the BuddyPort first). It is closed again on return, and
// the board is hard-reset, so it drops off USB and comes back as a new port.
// opts: { erase, onProgress(fraction 0..1), onStage(stage), log(text), resetMode, expectedMac }
// onStage gets "connect", "erase", "write" and "reset" as each one starts.
// resetMode is esptool-js's `main()` mode ("default_reset").
// expectedMac: when known (INFO), nothing is erased or written unless the chip
// has this MAC; another Buddy on the same computer throws WrongBoard.
// Nothing is erased or written on a board that isn't a Buddy (NotABuddy).
// A refused board is restarted into its own firmware.
export async function flashImage(serialPort, image, {
  erase = false, onProgress, onStage, log, resetMode = "default_reset", expectedMac = "",
} = {}) {
  const say = (text) => { if (log) log(String(text)); };
  const enter = (name) => { stage = name; if (onStage) onStage(name); };
  let transport = null;
  let stage = "connect";
  try {
    enter("connect");
    let loader;
    ({ transport, loader } = makeLoader(serialPort, say));
    await loader.main(resetMode);
    if (expectedMac) {
      const mac = await loader.chip.readMac(loader);
      if (!sameMac(mac, expectedMac)) throw new WrongBoard(`the chip is ${mac}, expected ${expectedMac}`);
    }
    await checkIsBuddy(loader, say);
    if (erase) {
      enter("erase");
      await loader.eraseFlash();
    }
    enter("write");
    await loader.writeFlash({
      fileArray: [{ data: image, address: 0 }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (_file, written, total) => {
        if (onProgress) onProgress(total > 0 ? Math.min(1, written / total) : 0);
      },
    });
    enter("reset");
    say("Restarting the Buddy");
    await resetToFirmware(transport.device ?? serialPort);
  } catch (e) {
    if (transport && (e instanceof NotABuddy || e instanceof WrongBoard)) await restartRefused(transport, serialPort);
    if (transport) { try { await transport.disconnect(); } catch { /* leave the port as it is */ } }
    throw new FlashError(stage, e);
  }
  // The flash is done and the board restarted. It re-enumerates on USB, so
  // closing the old port handle may fail; that is not a failed flash.
  try {
    await transport.disconnect();
  } catch (e) {
    say(`(the port was already gone when closing it: ${e && e.message ? e.message : e})`);
  }
}
