#!/usr/bin/env python3
"""Talk to a Monitor Buddy (firmware 1.2.0 or newer) over USB serial.

    python tools/mb_serial.py COM4 info
    python tools/mb_serial.py COM4 get
    python tools/mb_serial.py COM4 get --show-key   also prints stock_key
    python tools/mb_serial.py COM4 set ticker=AVGO theme=3 pages.stock=false
    python tools/mb_serial.py COM4 set '{"config":{"ticker":"AVGO"}}'
    python tools/mb_serial.py COM4 set @settings.json
    python tools/mb_serial.py COM4 wifi        asks for the SSID and password
    python tools/mb_serial.py COM4 reboot
    python tools/mb_serial.py COM4 defaults    deletes the saved settings; the
                                               Buddy goes back to its config.h
                                               values (Wi-Fi and brightness stay)
    python tools/mb_serial.py COM4 monitor     prints the serial log
    python tools/mb_serial.py COM4 selftest    protocol checks; restarts the
                                               Buddy five times

set takes key=value pairs (theme becomes a number; true/false become
booleans for pages.*; everything else is text), a JSON body, or @file.json.
Prefer key=value in PowerShell and cmd, which strip the quotes from JSON.

wifi asks for the password with getpass, which can hang in Git Bash (mintty).
Run it from PowerShell or cmd.

selftest changes the ticker, resets the settings with DEFAULTS and restores
them, and it leaves a /config.json on the board holding the original values. A
build from source then no longer picks up config.h edits for those keys; change
them with `set` instead.

set, wifi, defaults and reboot send their command once and wait up to 3 s. If
the reply never comes, the Buddy may still have saved the change and restarted,
so the tool reconnects and checks (GET or INFO) instead of resending: success
with a note when the change is there, an error when it is not. info and get
only read, so they are retried.

Exit codes: 0 ok, 1 the Buddy refused or did not answer, 2 bad arguments.

Needs pyserial:  pip install pyserial
"""
import argparse
import getpass
import json
import os
import random
import sys
import time

import serial

BAUD = 115200
MAX_ID = 2147483647
ANY = object()   # read_reply: accept a reply whatever its id
# Errors the Buddy sends without an id, because it never parsed the request's
# argument: the line was too long, the argument was not JSON, or a restart is
# pending and the argument did not parse.
IDLESS_ERRORS = ("line too long", "bad json", "restarting")
# Commands that change the board. They are never resent (see command()).
CHANGING = ("SET", "DEFAULTS", "REBOOT")
CHANGE_WAIT = 3.0


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


def read_line(s, end):
    """One full line, or None at the deadline. readline() with a 0.1 s port
    timeout can return half a line, so collect bytes until the newline."""
    buf = bytearray()
    while time.time() < end:
        c = s.read(1)   # one byte at a time, so nothing after the newline is lost
        if not c:
            continue
        if c == b"\n":
            return buf.decode("utf-8", "replace").strip()
        buf += c
    return None


_last_id = random.SystemRandom().randrange(1, 1 << 30)


def next_id():
    """The id for the next request. Each run starts somewhere else, so a stale
    reply left over from an earlier run can't match."""
    global _last_id
    _last_id = _last_id + 1 if _last_id < MAX_ID else 0
    return _last_id


def read_reply(s, wait, cmd=None, rid=ANY, idless_errors=False):
    """The next parseable @MB reply within `wait` seconds that answers the
    request, else None. A line that is not valid JSON counts as no reply.
    cmd: the command word the reply must echo (None: any). rid: the id it
    must echo; None means it must carry no id, ANY means don't look. Replies
    that don't match are stale answers to earlier requests and are skipped.
    idless_errors: for a request that had an id, also accept the error replies
    in IDLESS_ERRORS that carry the right cmd and no id, since the Buddy can't
    echo an id it never read. A reply with a different id is still stale."""
    end = time.time() + wait
    while time.time() < end:
        raw = read_line(s, end)
        if raw is None or not raw.startswith("@MB "):
            continue
        try:
            reply = json.loads(raw[4:])
        except ValueError:
            continue
        if not isinstance(reply, dict):
            continue
        if cmd is not None and reply.get("cmd") != cmd:
            continue
        if rid is not ANY and reply.get("id") != rid:
            idless = (idless_errors and cmd is not None and "id" not in reply
                      and reply.get("ok") is False and reply.get("error") in IDLESS_ERRORS)
            if not idless:
                continue
        return reply
    return None


def command(s, cmd, body=None, attempts=None, wait=None, rid=None):
    """Sends `cmd` with a fresh id (or `rid`) and returns the reply that echoes
    that id and command word. For SET the id goes into the body.

    INFO and GET only read, so they are sent up to 3 times, 1.5 s apart. SET,
    DEFAULTS and REBOOT change the board, so they are sent ONCE and given 3 s:
    the Buddy may have acted on the first copy and lost only its reply, and a
    second copy would hit a board that is restarting. Raises TimeoutError when
    no reply comes; use change() to find out what happened to the board."""
    changing = cmd in CHANGING
    if attempts is None:
        attempts = 1 if changing else 3
    if wait is None:
        wait = CHANGE_WAIT if changing else 1.5
    if rid is None:
        rid = next_id()
    payload = {"id": rid}
    if body is not None:
        payload.update({k: v for k, v in body.items() if k != "id"})
    line = "@MB " + cmd + " " + json.dumps(payload, separators=(",", ":"))
    for _ in range(attempts):
        s.reset_input_buffer()
        send_raw(s, line)
        reply = read_reply(s, wait, cmd, rid, idless_errors=True)
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


def _same(want, got):
    return want == got or (got is not None and str(want) == str(got))


def _read_ok(s, cmd):
    """GET or INFO as a reply with ok:true, or None. These only read, so a few
    tries are fine; the first may land in a restart window."""
    for _ in range(3):
        try:
            r = command(s, cmd)
        except (TimeoutError, OSError):
            return None
        if r.get("ok"):
            return r
        time.sleep(1)
    return None


def verify_change(s, cmd, body):
    """After a reply was lost: does the board show the change `cmd` asked for?
    Returns (ok, detail). Wi-Fi can't be checked by value (the password is
    write-only), so a SET with wifi is judged by INFO.wifi.ssid alone."""
    if cmd == "REBOOT":
        # Reconnecting after the port went away (reconnect() got INFO) is the
        # evidence; there is nothing else to compare.
        return True, "the Buddy answered again after the port was reopened"
    if cmd == "DEFAULTS":
        got = _read_ok(s, "GET")
        if got is None:
            return False, "GET did not answer"
        if got.get("stored") is False:
            return True, "the saved settings are gone (stored:false)"
        return False, "the saved settings are still there (stored:true)"
    # SET
    want = (body or {}).get("config") or {}
    if want:
        got = _read_ok(s, "GET")
        if got is None:
            return False, "GET did not answer"
        have = got.get("config") or {}
        for key, value in want.items():
            if key == "pages" and isinstance(value, dict):
                for page, on in value.items():
                    if (have.get("pages") or {}).get(page) is not on:
                        return False, f"pages.{page} is not {str(on).lower()} on the board"
            elif not _same(value, have.get(key)):
                return False, f"{key} is not the requested value on the board"
    wifi = (body or {}).get("wifi")
    if isinstance(wifi, dict):
        got = _read_ok(s, "INFO")
        if got is None:
            return False, "INFO did not answer"
        if (got.get("wifi") or {}).get("ssid") != wifi.get("ssid"):
            return False, "the saved Wi-Fi name is not the requested one"
    return True, "every requested value is on the board"


class Change:
    """The outcome of change(): the open port `s`, whether the change took
    effect (`ok`), the board's `reply` (None when it was lost), a `note` to show
    the user, and `restarted` (True when `s` is already a fresh connection)."""
    def __init__(self, s, ok, reply, note="", restarted=False):
        self.s, self.ok, self.reply, self.note, self.restarted = s, ok, reply, note, restarted


def change(s, port, cmd, body=None, wait_restart=False):
    """Sends SET, DEFAULTS or REBOOT once. If the reply arrives, that is the
    answer. If not, the board may still have done it, so reopen the port and
    check (verify_change) instead of resending. Never resends.

    wait_restart: after an ok reply, also wait for the restart and reconnect.
    The returned Change.s is the port to use from here on."""
    reply = None
    try:
        reply = command(s, cmd, body)
    except (TimeoutError, OSError):
        pass
    if reply is not None:
        if reply.get("ok") and wait_restart:
            s = restart_and_reconnect(s, port)
            return Change(s, True, reply, restarted=True)
        return Change(s, bool(reply.get("ok")), reply)
    # No reply. The board probably restarted 300 ms after answering.
    try:
        s.close()
    except OSError:
        pass
    time.sleep(1.5)
    try:
        s = reconnect(port)
    except (TimeoutError, OSError):
        return Change(s, False, None,
                      f"no reply to {cmd} and the Buddy did not come back; check it with `info`")
    ok, detail = verify_change(s, cmd, body)
    if ok:
        return Change(s, True, None,
                      f"the reply to {cmd} was lost, but the change is on the board ({detail})",
                      restarted=True)
    return Change(s, False, None, f"no reply to {cmd}, and it did not take effect ({detail})",
                  restarted=True)



REDACTED = "<redacted>"
CONFIG_KEYS = ["mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
               "stock_key", "lat", "lon", "temp_unit", "wind_unit"]
PAGE_KEYS = ["face", "clock", "date", "weather", "moon", "stock", "github"]


def redact(obj):
    """A copy of obj that is safe to print: a non-empty stock_key is hidden."""
    if isinstance(obj, dict):
        return {k: (REDACTED if k == "stock_key" and v else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def parse_json_body(text, where):
    try:
        body = json.loads(text)
    except ValueError as e:
        raise ValueError(
            f"{where} is not valid JSON ({e}). PowerShell and cmd strip the quotes "
            "from JSON on the command line; use key=value pairs instead, "
            "e.g. set ticker=AVGO") from None
    if not isinstance(body, dict):
        raise ValueError(f"{where} must be a JSON object, e.g. {{\"config\":{{\"theme\":1}}}}")
    return body


def parse_set_args(args):
    """The SET body for `set`: key=value pairs, a JSON body, or @file.json.
    Raises ValueError with a readable message."""
    if not args:
        raise ValueError("set needs key=value pairs, a JSON body or @file.json")
    if len(args) == 1 and args[0].startswith("@"):
        path = args[0][1:]
        try:
            with open(path, encoding="utf-8-sig") as f:
                text = f.read()
        except OSError as e:
            raise ValueError(f"cannot read {path}: {e.strerror}") from None
        return parse_json_body(text, path)
    if args[0].lstrip().startswith("{"):
        return parse_json_body(" ".join(args), "the SET body")
    config = {}
    for arg in args:
        key, sep, value = arg.partition("=")
        key = key.strip()
        if not sep or not key:
            raise ValueError(f"'{arg}' is not key=value")
        if key.startswith("pages."):
            page = key[len("pages."):]
            if page not in PAGE_KEYS:
                raise ValueError(f"unknown page '{page}' (use one of: {', '.join(PAGE_KEYS)})")
            if value.lower() not in ("true", "false"):
                raise ValueError(f"{key} must be true or false")
            config.setdefault("pages", {})[page] = value.lower() == "true"
        elif key == "theme":
            try:
                config[key] = int(value)
            except ValueError:
                raise ValueError("theme must be a whole number (0-4)") from None
        elif key in CONFIG_KEYS:
            config[key] = value
        else:
            raise ValueError(f"unknown setting '{key}' (use one of: "
                             f"{', '.join(CONFIG_KEYS)}, pages.<name>)")
    return {"config": config}


def selftest(port):
    results = []

    def check(name, cond, detail=""):
        results.append(bool(cond))
        print(("PASS " if cond else "FAIL ") + name + (f"  ({redact(detail)})" if detail and not cond else ""))

    def ask(s, line, cmd, rid=None, wait=1.5):
        """Sends a raw line; the reply to `cmd` that carries id `rid` (None: no id)."""
        s.reset_input_buffer()
        send_raw(s, line)
        return read_reply(s, wait, cmd, rid)

    s = open_port(port)
    rid = next_id()
    info = command(s, "INFO", rid=rid)
    check("INFO ok", info.get("ok") is True, info)
    check("INFO echoes cmd and id", info.get("cmd") == "INFO" and info.get("id") == rid, info)
    check("INFO has fw, cfg_v 1, mac", bool(info.get("fw")) and info.get("cfg_v") == 1
          and len(info.get("mac", "")) == 17, info)
    check("INFO wifi block", {"saved", "ssid", "connected"} <= set(info.get("wifi", {})), info)
    r = ask(s, "@MB INFO", "INFO")
    check("bare INFO works and the reply has no id", r is not None and r.get("ok") is True, r)

    rid = next_id()
    got = command(s, "GET", rid=rid)
    original = got.get("config", {})
    keys = {"v", "mount", "theme", "github_user", "tz_name", "tz_rule", "ticker",
            "stock_key", "lat", "lon", "temp_unit", "wind_unit", "pages"}
    check("GET ok with every key", got.get("ok") is True and set(original) == keys, got)
    check("GET echoes cmd and id", got.get("cmd") == "GET" and got.get("id") == rid, got)
    check("GET 7 pages", len(original.get("pages", {})) == 7, original.get("pages"))
    check("GET has a stored flag", isinstance(got.get("stored"), bool), got.get("stored"))
    was_stored = got.get("stored") is True
    if not original:
        s.close()
        print("\nCannot go on without the current settings.")
        return 1

    def current_state(s):
        """The Buddy's GET reply, reconnecting if it is mid-restart."""
        try:
            got = command(s, "GET")
            if got.get("ok"):
                return s, got
        except (TimeoutError, OSError):
            pass
        s.close()
        time.sleep(2)
        s = reconnect(port)
        return s, command(s, "GET")

    try:
        rid = next_id()
        r = ask(s, f'@MB HELLO {{"id":{rid}}}', "HELLO", rid)
        check("unknown command", r == {"ok": False, "cmd": "HELLO", "id": rid,
                                       "error": "unknown command"}, r)
        r = ask(s, "@MB ABCDEFGHIJKLMNOPQRSTUVWXYZ", "ABCDEFGHIJKLMNOP")
        check("unknown command is cut to 16 characters in cmd",
              r == {"ok": False, "cmd": "ABCDEFGHIJKLMNOP", "error": "unknown command"}, r)
        r = ask(s, "@MB INFO {bad", "INFO")
        check("INFO with bad json", r == {"ok": False, "cmd": "INFO", "error": "bad json"}, r)
        r = ask(s, "@MB GET [1]", "GET")
        check("GET with a non-object argument", r == {"ok": False, "cmd": "GET", "error": "bad json"}, r)
        r = ask(s, '@MB INFO {"id":"x"}', "INFO")
        check("INFO with a bad id", r == {"ok": False, "cmd": "INFO", "error": "bad id"}, r)
        r = ask(s, '@MB GET {"id":-1}', "GET")
        check("GET with a negative id", r == {"ok": False, "cmd": "GET", "error": "bad id"}, r)
        r = ask(s, '@MB INFO {"id":2147483648}', "INFO")
        check("INFO with an id out of range", r == {"ok": False, "cmd": "INFO", "error": "bad id"}, r)
        r = ask(s, "@MB SET {nope", "SET")
        check("bad json", r == {"ok": False, "cmd": "SET", "error": "bad json"}, r)
        r = ask(s, "@MB SET", "SET")
        check("SET without a body", r == {"ok": False, "cmd": "SET", "error": "bad json"}, r)
        r = ask(s, '@MB SET {"id":"x","config":{"theme":2}}', "SET")
        check("SET with a bad id saves nothing", r == {"ok": False, "cmd": "SET", "error": "bad id"}, r)
        rid = next_id()
        r = command(s, "SET", {"config": {"theme": 9}}, rid=rid)
        check("invalid value rejected", r.get("ok") is False and r.get("cmd") == "SET"
              and r.get("id") == rid and "theme" in r.get("errors", {}), r)
        r = command(s, "SET", {"wifi": {"ssid": "", "password": "x"}})
        check("invalid wifi rejected", r.get("ok") is False and "wifi.ssid" in r.get("errors", {}), r)
        r = command(s, "SET", {"wifi": {"ssid": "selftest"}})
        check("wifi without a password rejected",
              r.get("ok") is False and "wifi.password" in r.get("errors", {}), r)
        r = command(s, "SET", {"config": {"ticker": "ZZZZ"}, "wifi": {"ssid": "", "password": "x"}})
        check("valid config + invalid wifi rejected", r.get("ok") is False and "wifi.ssid" in r.get("errors", {}), r)
        check("nothing saved after rejects", command(s, "GET").get("config") == original)
        r = ask(s, "@MB SET " + "x" * 2100, "SET")
        check("line too long", r == {"ok": False, "cmd": "SET", "error": "line too long"}, r)
        try:   # the tool's own path must show the error, not time out
            r = command(s, "SET", {"config": {"github_user": "x" * 2100}})
        except TimeoutError as e:
            r = str(e)
        check("oversize SET from command() reports line too long",
              r == {"ok": False, "cmd": "SET", "error": "line too long"}, r)
        s.reset_input_buffer()
        send_raw(s, "hello buddy")
        check("non-protocol line ignored", read_reply(s, 1.5) is None)

        # Lock contention: with no delay between commands, the Buddy's reply
        # often meets another task mid-print. Every reply must still arrive.
        missing = []
        for i in range(30):
            rid = next_id()
            send_raw(s, f'@MB INFO {{"id":{rid}}}')
            r = read_reply(s, 3.0, "INFO", rid)
            if r is None or r.get("ok") is not True:
                missing.append(i)
        check("30 INFO back to back, all answered", not missing, f"no reply to {missing}")

        # GET only shows the settings loaded at boot, so restart to prove that no
        # rejected SET wrote anything to flash.
        c = change(s, port, "REBOOT", wait_restart=True)
        s = c.s
        check("reboot ok", c.ok and (c.reply is None or c.reply.get("cmd") == "REBOOT"), c.reply or c.note)
        after = command(s, "GET")
        check("rejected SETs saved no config", after.get("config") == original)
        check("rejected SETs left the stored flag", after.get("stored") is was_stored, after.get("stored"))
        after_wifi = command(s, "INFO").get("wifi", {})
        check("rejected SETs left the saved wifi", after_wifi.get("ssid") == info.get("wifi", {}).get("ssid"), after_wifi)

        new_ticker = "MSFT" if original.get("ticker") != "MSFT" else "AVGO"
        rid = next_id()
        r = command(s, "SET", {"config": {"ticker": new_ticker}}, rid=rid)
        check("partial SET ok", r == {"ok": True, "cmd": "SET", "id": rid}, r)
        # The Buddy restarts 300 ms after that reply. Until then it must refuse
        # commands: a second SET would merge into stale settings, and a GET
        # would report values that are about to change. Both probes go out
        # before either reply is read, so the 300 ms can't run out in between.
        rid = next_id()
        s.reset_input_buffer()
        send_raw(s, f'@MB GET {{"id":{rid}}}')
        send_raw(s, "@MB GET {bad")
        r = read_reply(s, 1.5, "GET", rid)
        check("GET in the restart window is refused",
              r == {"ok": False, "cmd": "GET", "id": rid, "error": "restarting"}, r)
        r = read_reply(s, 1.5, "GET", None)
        check("restart window: an argument that doesn't parse gets no id",
              r == {"ok": False, "cmd": "GET", "error": "restarting"}, r)
        s = restart_and_reconnect(s, port)
        after = command(s, "GET")
        expected = dict(original, ticker=new_ticker)
        check("partial SET kept the other keys", after.get("config") == expected, after.get("config"))
        check("added empty after a save", after.get("added") == [], after.get("added"))
        check("stored after a save", after.get("stored") is True, after.get("stored"))

        # DEFAULTS deletes /config.json; the next boot uses the config.h values.
        c = change(s, port, "DEFAULTS", wait_restart=True)
        s = c.s
        check("DEFAULTS ok", c.ok and (c.reply is None or c.reply.get("cmd") == "DEFAULTS"), c.reply or c.note)
        after = command(s, "GET")
        check("DEFAULTS cleared the stored flag", after.get("stored") is False, after.get("stored"))
        check("added empty with no file", after.get("added") == [], after.get("added"))
        # The config now holds the config.h values, which in general differ from
        # `original`, so they are not compared.
        after_wifi = command(s, "INFO").get("wifi", {})
        check("DEFAULTS left the saved wifi", after_wifi.get("ssid") == info.get("wifi", {}).get("ssid"), after_wifi)
        c = change(s, port, "DEFAULTS", wait_restart=True)
        s = c.s
        check("DEFAULTS with no file is still ok", c.ok, c.reply or c.note)
        check("second DEFAULTS left stored false", command(s, "GET").get("stored") is False)

        c = change(s, port, "SET", {"config": original}, wait_restart=True)
        s = c.s
        check("SET original ok", c.ok and (c.reply is None or c.reply.get("cmd") == "SET"), c.reply or c.note)
        after = command(s, "GET")
        check("SET after DEFAULTS stored the config", after.get("stored") is True, after.get("stored"))
        check("config is the original again", after.get("config") == original, after.get("config"))
    finally:
        # Put the original settings back, also when a check above blew up, and
        # also when it blew up between DEFAULTS and the restore.
        try:
            s, got = current_state(s)
            now = got.get("config")
            if now != original or (was_stored and got.get("stored") is not True):
                c = change(s, port, "SET", {"config": original}, wait_restart=True)
                s = c.s
                check("restore SET ok", c.ok, c.reply or c.note)
                got = command(s, "GET")
                now = got.get("config")
            check("settings restored", now == original and (not was_stored or got.get("stored") is True))
        except Exception as e:  # keep the original error, if there is one
            results.append(False)
            print(f"FAIL could not restore the original settings ({e}); check them with `get`")
        try:
            s.close()
        except Exception:
            pass

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


def monitor(s):
    buf = bytearray()
    try:
        while True:
            buf += s.read(s.in_waiting or 1)
            while b"\n" in buf:
                line, _, rest = bytes(buf).partition(b"\n")
                buf = bytearray(rest)
                line = line.decode("utf-8", "replace").rstrip()
                if line:
                    print(line, flush=True)
    except KeyboardInterrupt:
        return 0


def report(c):
    """Prints a Change: the board's reply, or what we found out instead.
    Returns the exit code."""
    if c.reply is not None:
        print(c.reply)
    elif c.ok:
        print("ok: " + c.note)
    else:
        print("error: " + c.note, file=sys.stderr)
    return 0 if c.ok else 1


def run(a, parser):
    if a.action == "selftest":
        return selftest(a.port)

    body = None
    if a.action == "set":
        try:
            body = parse_set_args(a.args)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    elif a.args:
        parser.error(f"{a.action} takes no extra arguments")

    s = open_port(a.port)
    if a.action == "monitor":
        return monitor(s)
    if a.action == "info":
        print(json.dumps(command(s, "INFO"), indent=2))
    elif a.action == "get":
        r = command(s, "GET")
        print(json.dumps(r if a.show_key else redact(r), indent=2))
        return 0 if r.get("ok") else 1
    elif a.action == "reboot":
        return report(change(s, a.port, "REBOOT"))
    elif a.action == "set":
        return report(change(s, a.port, "SET", body))
    elif a.action == "defaults":
        c = change(s, a.port, "DEFAULTS", wait_restart=True)
        if report(c):
            return 1
        s = c.s
        r = command(s, "GET")
        print(json.dumps(redact(r), indent=2))
        s.close()
        return 0 if r.get("ok") else 1
    elif a.action == "wifi":
        if os.environ.get("MSYSTEM"):
            print("Git Bash can hang at the password prompt. If it does, press Ctrl+C "
                  "and run this from PowerShell or cmd.")
        ssid = input("Wi-Fi name (SSID): ").strip()
        password = getpass.getpass("Wi-Fi password (empty for an open network): ")
        c = change(s, a.port, "SET", {"wifi": {"ssid": ssid, "password": password}},
                   wait_restart=True)
        if report(c):
            return 1
        s = c.s
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


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            # AWM logs emoji; a cp1252 console would crash on them.
            stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("port")
    p.add_argument("action", choices=["info", "get", "set", "wifi", "reboot", "defaults", "monitor", "selftest"])
    p.add_argument("args", nargs="*", help="for set: key=value pairs, a JSON body, or @file.json")
    p.add_argument("--show-key", action="store_true", help="get: print stock_key instead of hiding it")
    a = p.parse_args()
    try:
        return run(a, p)
    except (TimeoutError, OSError) as e:   # includes serial.SerialException
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
