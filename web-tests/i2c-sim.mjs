// A simulated ESP32-C6 board for boardcheck.js: the GPIO registers as esptool
// reaches them, wired to an I2C bus. Shared by the board check tests.
import { SDA, SCL, IMU_ADDR, IMU_ID, TOUCH_ADDR } from "../web/js/boardcheck.js";

// The ESP32-C6's GPIO registers as checkBoard() reaches them through the ROM
// (esptool READ_REG/WRITE_REG), wired to a simulated I2C bus on GPIO18/19.
const IO_MUX = 0x60090000;
const GPIO = 0x60091000;
export const OUT = GPIO + 0x04, OUT_W1TS = GPIO + 0x08, OUT_W1TC = GPIO + 0x0c;
export const EN = GPIO + 0x20, EN_W1TS = GPIO + 0x24, EN_W1TC = GPIO + 0x28, IN = GPIO + 0x3c;
export const outSel = (n) => GPIO + 0x554 + 4 * n;
export const mux = (n) => IO_MUX + 0x04 + 4 * n;
const FUN_WPU = 1 << 8;
export const OUT_INV = 1 << 8; // in GPIO_FUNCn_OUT_SEL_CFG: inverts the output

// A minimal I2C target: ACKs its address, takes a register pointer, returns
// registers on reads. It drives SDA low only (open drain), like the real parts.
function target(addr, registers = {}) {
  return {
    addr, registers, phase: "idle", byte: 0, bits: 0, rw: 0, ptr: 0, out: 0, low: false, pointerSet: false,
    start() { this.phase = "addr"; this.byte = 0; this.bits = 0; this.low = false; this.pointerSet = false; },
    stop() { this.phase = "idle"; this.low = false; },
    rise(sda) {
      if (this.phase === "addr" || this.phase === "wdata") { this.byte = (this.byte << 1) | sda; this.bits++; }
    },
    fall() {
      if ((this.phase === "addr" || this.phase === "wdata") && this.bits === 8) {
        if (this.phase === "addr") {
          if (this.byte >> 1 !== this.addr) { this.phase = "idle"; return; }
          this.rw = this.byte & 1;
        } else if (!this.pointerSet) {
          this.ptr = this.byte;
          this.pointerSet = true;
        }
        this.phase = "ack";
        this.low = true;
      } else if (this.phase === "ack") {
        this.low = false;
        if (this.rw) { this.phase = "rdata"; this.out = this.registers[this.ptr] ?? 0xff; this.bits = 0; this.low = !(this.out & 0x80); }
        else { this.phase = "wdata"; this.byte = 0; this.bits = 0; }
      } else if (this.phase === "rdata") {
        this.bits++;
        if (this.bits < 8) this.low = !((this.out >> (7 - this.bits)) & 1);
        else { this.low = false; this.phase = "rack"; }
      } else if (this.phase === "rack") {
        this.phase = "idle";
      }
    },
  };
}

// The chip plus the board around it. pullups: the board's own resistors on
// SDA and SCL. floating: what an unconnected, un-pulled pin reads.
export function board({ devices = [], pullups = true, floating = 0, imuId = IMU_ID } = {}) {
  const parts = devices.map((d) => (d === "imu" ? target(IMU_ADDR, { 0x00: imuId }) : target(TOUCH_ADDR)));
  const regs = new Map([
    [OUT, 0], [EN, 0],
    [mux(SDA), 0xb00], [mux(SCL), 0xb00], [outSel(SDA), 0x80], [outSel(SCL), 0x80],
  ]);
  const b = {
    regs, parts, ops: 0, droveHigh: false, pulledLowBeforeIdleCheck: false,
    get: (a) => regs.get(a) ?? 0,
    drivesLow(pin) {
      const en = (b.get(EN) >> pin) & 1;
      const out = ((b.get(OUT) >> pin) & 1) ^ ((b.get(outSel(pin)) & OUT_INV) ? 1 : 0);
      if (en && out) b.droveHigh = true;
      return en && !out;
    },
    level(pin) {
      if (b.drivesLow(pin)) return 0;
      if (pin === SDA && parts.some((p) => p.low)) return 0;
      return pullups || (b.get(mux(pin)) & FUN_WPU) ? 1 : floating;
    },
    prev: null,
    settle() {
      const now = { sda: b.level(SDA), scl: b.level(SCL) };
      const p = b.prev || now;
      if (p.scl !== now.scl) {
        for (const t of parts) (now.scl ? t.rise(now.sda) : t.fall());
      } else if (now.scl && p.sda !== now.sda) {
        for (const t of parts) (now.sda ? t.stop() : t.start());
      }
      b.prev = { sda: b.level(SDA), scl: b.level(SCL) };
    },
    async read(addr) {
      b.ops++;
      // Other pins read as on the real board (0x777f527c), minus SDA and SCL.
      if (addr === IN) return (b.level(SDA) << SDA) | (b.level(SCL) << SCL) | (0x777f527c & ~((1 << SDA) | (1 << SCL)));
      return b.get(addr);
    },
    async write(addr, value) {
      b.ops++;
      value >>>= 0;
      if (addr === OUT_W1TS) regs.set(OUT, b.get(OUT) | value);
      else if (addr === OUT_W1TC) regs.set(OUT, b.get(OUT) & ~value);
      else if (addr === EN_W1TS) regs.set(EN, b.get(EN) | value);
      else if (addr === EN_W1TC) regs.set(EN, b.get(EN) & ~value);
      else regs.set(addr, value);
      b.settle();
    },
  };
  b.settle();
  return b;
}
