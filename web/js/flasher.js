// Download, verify and flash a firmware image with the vendored esptool-js.
import { ESPLoader, Transport } from "../vendor/esptool-js/bundle.js";

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
export async function fetchImage(entry, siteRoot) {
  const url = new URL(entry.file, siteRoot);
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new DownloadError(`could not download ${url.pathname}: ${e.message}`);
  }
  if (!response.ok) throw new DownloadError(`could not download ${url.pathname}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length !== entry.size) {
    throw new ImageMismatch(`the image is ${data.length} bytes, expected ${entry.size}`);
  }
  const digest = hex(await crypto.subtle.digest("SHA-256", data));
  if (digest !== String(entry.sha256).toLowerCase()) {
    throw new ImageMismatch("the image's SHA-256 does not match the release list");
  }
  return data;
}

// Writes `image` at address 0. `serialPort` must be CLOSED: esptool-js opens
// it itself (so close the BuddyPort first). It is closed again on return, and
// the board is hard-reset, so it drops off USB and comes back as a new port.
// opts: { erase, onProgress(fraction 0..1), log(text), resetMode }
// resetMode is esptool-js's `main()` mode; "default_reset" unless the spike
// finds that "usb_reset" is what the C6's USB-serial/JTAG needs.
export async function flashImage(serialPort, image, { erase = false, onProgress, log, resetMode = "default_reset" } = {}) {
  const say = (text) => { if (log) log(String(text)); };
  const terminal = { clean() {}, write: say, writeLine: say };
  let transport = null;
  let stage = "connect";
  try {
    transport = new Transport(serialPort);
    const loader = new ESPLoader({ transport, baudrate: 115200, terminal });
    await loader.main(resetMode);
    if (erase) {
      stage = "erase";
      await loader.eraseFlash();
    }
    stage = "write";
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
    stage = "reset";
    await loader.after("hard_reset");
  } catch (e) {
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
