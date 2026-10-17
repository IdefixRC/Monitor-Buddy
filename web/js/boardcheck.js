// Is this a Monitor Buddy board? The chip alone can't tell: Waveshare's
// ESP32-C6-LCD-1.47 without touch has the same ESP32-C6FH8, flash and USB IDs
// (measured 2026-10-17, COM6 and COM12). What the Buddy firmware needs is on
// the board: the QMI8658 motion sensor and the AXS5106L touch controller on
// I2C, GPIO18 (SDA) and GPIO19 (SCL). Both answer while the chip sits in the
// ROM's download mode, so this asks them through esptool's register access:
// I2C clocked by hand, one register write per edge, well under a second.
// regs: { read(addr) -> Promise<number>, write(addr, value) -> Promise }.

export const BUDDY_CHIP = "ESP32-C6"; // esptool-js chip.CHIP_NAME
export const SDA = 18;
export const SCL = 19;
export const IMU_ADDR = 0x6b;
export const IMU_ID = 0x05; // QMI8658 WHO_AM_I (register 0x00), as src/main.cpp checks it
export const TOUCH_ADDR = 0x63;

const IO_MUX = 0x60090000;
const GPIO = 0x60091000;
const OUT = GPIO + 0x04;
const OUT_W1TS = GPIO + 0x08;
const OUT_W1TC = GPIO + 0x0c;
const EN = GPIO + 0x20;
const EN_W1TS = GPIO + 0x24;
const EN_W1TC = GPIO + 0x28;
const IN = GPIO + 0x3c;
const outSel = (n) => GPIO + 0x554 + 4 * n; // GPIO_FUNCn_OUT_SEL_CFG
const mux = (n) => IO_MUX + 0x04 + 4 * n; // IO_MUX_GPIOn
// Plain GPIO output, not inverted. Bit 8 there INVERTS the output: with it set,
// "pull low" drove the line high (the spike's first run, 2026-10-17).
const OUT_SEL_GPIO = 0x80;
// IO_MUX: function 1 (GPIO), input enabled, drive strength 2, no pull-ups.
const MUX_GPIO_INPUT = (1 << 12) | (1 << 9) | (2 << 10);
const STRETCH_READS = 50;

// Resolves { ok: true } or { ok: false, why, detail }. why is "pullups" (the
// lines don't idle high, so nothing was pulled low), "imu", "touch" or "bus"
// (SCL stuck low). Throws when a register access fails. The pins are put back
// as they were found either way.
export async function checkBoard(regs) {
  const pins = (1 << SDA) | (1 << SCL);
  const saved = {
    out: await regs.read(OUT),
    en: await regs.read(EN),
    sel: [await regs.read(outSel(SDA)), await regs.read(outSel(SCL))],
    mux: [await regs.read(mux(SDA)), await regs.read(mux(SCL))],
  };
  const low = (pin) => regs.write(EN_W1TS, 1 << pin); // OUT is 0: enabling pulls low
  const release = (pin) => regs.write(EN_W1TC, 1 << pin); // the pull-ups take it high
  const level = async (pin) => ((await regs.read(IN)) >>> pin) & 1;
  try {
    await regs.write(EN_W1TC, pins);
    await regs.write(OUT_W1TC, pins);
    for (const pin of [SDA, SCL]) {
      await regs.write(outSel(pin), OUT_SEL_GPIO);
      await regs.write(mux(pin), MUX_GPIO_INPUT);
    }
    // A Buddy has its own pull-ups on both lines. A board without them isn't
    // one, and there may be something on those pins we shouldn't pull at.
    const idle = (await regs.read(IN)) >>> 0;
    if (!((idle >>> SDA) & 1) || !((idle >>> SCL) & 1)) {
      return { ok: false, why: "pullups", detail: `SDA=${(idle >>> SDA) & 1} SCL=${(idle >>> SCL) & 1} at idle` };
    }

    class Stuck extends Error {}
    const sclHigh = async () => {
      await release(SCL);
      for (let i = 0; i < STRETCH_READS; i++) if (await level(SCL)) return;
      throw new Stuck("SCL held low");
    };
    const start = async () => { await release(SDA); await sclHigh(); await low(SDA); await low(SCL); };
    const stop = async () => { await low(SDA); await sclHigh(); await release(SDA); };
    const writeByte = async (byte) => {
      for (let i = 7; i >= 0; i--) {
        await ((byte >> i) & 1 ? release(SDA) : low(SDA));
        await sclHigh();
        await low(SCL);
      }
      await release(SDA);
      await sclHigh();
      const ack = (await level(SDA)) === 0;
      await low(SCL);
      return ack;
    };
    const readByte = async () => { // then NACK: one byte is all we read
      await release(SDA);
      let v = 0;
      for (let i = 0; i < 8; i++) {
        await sclHigh();
        v = (v << 1) | (await level(SDA));
        await low(SCL);
      }
      await sclHigh();
      await low(SCL);
      return v;
    };
    const readRegister = async (addr, reg) => {
      await start();
      if (!(await writeByte(addr << 1))) { await stop(); return null; }
      await writeByte(reg);
      await start(); // repeated start
      await writeByte((addr << 1) | 1);
      const v = await readByte();
      await stop();
      return v;
    };
    const answers = async (addr) => {
      await start();
      const ack = await writeByte(addr << 1);
      await stop();
      return ack;
    };

    try {
      const id = await readRegister(IMU_ADDR, 0x00);
      if (id !== IMU_ID) {
        const got = id === null ? "no answer" : `ID 0x${id.toString(16).padStart(2, "0")}`;
        return { ok: false, why: "imu", detail: `motion sensor at 0x${IMU_ADDR.toString(16)}: ${got}` };
      }
      if (!(await answers(TOUCH_ADDR))) {
        return { ok: false, why: "touch", detail: `no touch controller at 0x${TOUCH_ADDR.toString(16)}` };
      }
      return { ok: true, detail: "motion sensor and touch controller found" };
    } catch (e) {
      if (e instanceof Stuck) return { ok: false, why: "bus", detail: e.message };
      throw e;
    }
  } finally {
    // Release first, then restore, so the lines never pass through "driven".
    await regs.write(EN_W1TC, pins);
    await regs.write(outSel(SDA), saved.sel[0]);
    await regs.write(outSel(SCL), saved.sel[1]);
    await regs.write(mux(SDA), saved.mux[0]);
    await regs.write(mux(SCL), saved.mux[1]);
    if (saved.out & pins) await regs.write(OUT_W1TS, saved.out & pins);
    if (saved.en & pins) await regs.write(EN_W1TS, saved.en & pins);
  }
}
