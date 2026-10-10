#!/usr/bin/env python3
"""Talk to a Monitor Buddy (firmware 1.2.0 or newer) over USB serial.

    python tools/mb_serial.py COM4 info
    python tools/mb_serial.py COM4 get
    python tools/mb_serial.py COM4 set '{"config":{"ticker":"AVGO"}}'
    python tools/mb_serial.py COM4 wifi        asks for the SSID and password
    python tools/mb_serial.py COM4 reboot
    python tools/mb_serial.py COM4 monitor     prints the serial log
    python tools/mb_serial.py COM4 selftest    protocol checks; restarts the
                                               Buddy twice, restores settings

Needs pyserial:  pip install pyserial
"""
import argparse
import getpass
import json
import sys
import time

import serial

BAUD = 115200


def open_port(port):
    s = serial.Serial()
    s.port = port
    s.baudrate = BAUD
    s.timeout = 0.1
    # Opening with DTR/RTS asserted resets the ESP32-C6 over USB (rst=11).
    s.dtr = False
    s.rts = False
    s.open()
    return s


def send_raw(s, text):
    s.write((text + "\n").encode("utf-8"))


def read_reply(s, wait):
    end = time.time() + wait
    while time.time() < end:
        raw = s.readline().decode("utf-8", "replace").strip()
        if raw.startswith("@MB "):
            return json.loads(raw[4:])
    return None


def command(s, cmd, body=None, attempts=3, wait=1.5):
    line = "@MB " + cmd
    if body is not None:
        line += " " + json.dumps(body, separators=(",", ":"))
    for _ in range(attempts):
        s.reset_input_buffer()
        send_raw(s, line)
        reply = read_reply(s, wait)
        if reply is not None:
            return reply
    raise TimeoutError(f"no reply to {cmd}")


def drain(s, quiet):
    """Discard input until the line has been silent for `quiet` seconds."""
    last = time.time()
    while time.time() - last < quiet:
        if s.read(256):
            last = time.time()


def reconnect(port, timeout=40):
    """After a restart: reopen the port (it may vanish briefly on USB) and
    wait until INFO answers. setup() blocks for up to ~18 s."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            s = open_port(port)
        except serial.SerialException:
            time.sleep(1)
            continue
        try:
            command(s, "INFO", attempts=1, wait=1.5)
            # Earlier probes sat in the Buddy's RX buffer while setup() ran, so
            # it answers them in a burst right after. Drop those replies, or
            # the next command would read one of them as its own.
            drain(s, 0.5)
            return s
        except (TimeoutError, serial.SerialException):
            s.close()
            time.sleep(1)
    raise TimeoutError("the Buddy did not come back")


def restart_and_reconnect(s, port):
    time.sleep(1.5)   # the Buddy restarts 300 ms after its reply
    s.close()
    return reconnect(port)


def selftest(port):
    results = []

    def check(name, cond, detail=""):
        results.append(cond)
        print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))

    s = open_port(port)
    info = command(s, "INFO")
    check("INFO ok", info.get("ok") is True, info)
    check("INFO has fw, cfg_v 1, mac", bool(info.get("fw")) and info.get("cfg_v") == 1
          and len(info.get("mac", "")) == 17, info)
    check("INFO wifi block", {"saved", "ssid", "connected"} <= set(info.get("wifi", {})), info)

    got = command(s, "GET")
    original = got.get("config", {})
    keys = {"v", "mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
            "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages"}
    check("GET ok with every key", got.get("ok") is True and set(original) == keys, got)
    check("GET 7 pages", len(original.get("pages", {})) == 7, original.get("pages"))

    r = command(s, "HELLO")
    check("unknown command", r == {"ok": False, "error": "unknown command"}, r)
    send_raw(s, "@MB SET {nope")
    r = read_reply(s, 1.5)
    check("bad json", r == {"ok": False, "error": "bad json"}, r)
    r = command(s, "SET", {"config": {"theme": 9}})
    check("invalid value rejected", r.get("ok") is False and "theme" in r.get("errors", {}), r)
    r = command(s, "SET", {"wifi": {"ssid": "", "password": "x"}})
    check("invalid wifi rejected", r.get("ok") is False and "wifi.ssid" in r.get("errors", {}), r)
    r = command(s, "SET", {"config": {"ticker": "ZZZZ"}, "wifi": {"ssid": "", "password": "x"}})
    check("valid config + invalid wifi rejected", r.get("ok") is False and "wifi.ssid" in r.get("errors", {}), r)
    check("nothing saved after rejects", command(s, "GET").get("config") == original)
    send_raw(s, "@MB SET " + "x" * 2100)
    r = read_reply(s, 1.5)
    check("line too long", r == {"ok": False, "error": "line too long"}, r)
    s.reset_input_buffer()
    send_raw(s, "hello buddy")
    check("non-protocol line ignored", read_reply(s, 1.5) is None)

    # GET only shows the settings loaded at boot, so restart to prove that no
    # rejected SET wrote anything to flash.
    r = command(s, "REBOOT")
    check("reboot ok", r == {"ok": True}, r)
    s = restart_and_reconnect(s, port)
    check("rejected SETs saved no config", command(s, "GET").get("config") == original)
    after_wifi = command(s, "INFO").get("wifi", {})
    check("rejected SETs left the saved wifi", after_wifi.get("ssid") == info.get("wifi", {}).get("ssid"), after_wifi)

    new_ticker = "MSFT" if original.get("ticker") != "MSFT" else "AVGO"
    r = command(s, "SET", {"config": {"ticker": new_ticker}})
    check("partial SET ok", r == {"ok": True}, r)
    s = restart_and_reconnect(s, port)
    after = command(s, "GET")
    expected = dict(original, ticker=new_ticker)
    check("partial SET kept the other keys", after.get("config") == expected, after.get("config"))
    check("added empty after a save", after.get("added") == [], after.get("added"))

    r = command(s, "SET", {"config": original})
    check("restore SET ok", r == {"ok": True}, r)
    s = restart_and_reconnect(s, port)
    check("settings restored", command(s, "GET").get("config") == original)
    s.close()

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("port")
    p.add_argument("action", choices=["info", "get", "set", "wifi", "reboot", "monitor", "selftest"])
    p.add_argument("json", nargs="?", help="the SET body, e.g. '{\"config\":{\"theme\":1}}'")
    a = p.parse_args()

    if a.action == "selftest":
        return selftest(a.port)
    s = open_port(a.port)
    if a.action == "monitor":
        try:
            while True:
                line = s.readline().decode("utf-8", "replace").rstrip()
                if line:
                    print(line)
        except KeyboardInterrupt:
            return 0
    if a.action == "info":
        print(json.dumps(command(s, "INFO"), indent=2))
    elif a.action == "get":
        print(json.dumps(command(s, "GET"), indent=2))
    elif a.action == "reboot":
        print(command(s, "REBOOT"))
    elif a.action == "set":
        if not a.json:
            p.error("set needs a JSON body")
        print(command(s, "SET", json.loads(a.json)))
    elif a.action == "wifi":
        ssid = input("Wi-Fi name (SSID): ").strip()
        password = getpass.getpass("Wi-Fi password (empty for an open network): ")
        r = command(s, "SET", {"wifi": {"ssid": ssid, "password": password}})
        print(r)
        if r.get("ok"):
            s = restart_and_reconnect(s, a.port)
            for _ in range(30):
                w = command(s, "INFO")["wifi"]
                if w.get("connected"):
                    print(f"Connected to {w.get('ssid')} (RSSI {w.get('rssi')})")
                    return 0
                time.sleep(1)
            print("Not connected after 30 s. Check the password; the setup hotspot may be open.")
            return 1
    s.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
