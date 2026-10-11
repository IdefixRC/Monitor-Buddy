#!/usr/bin/env python3
"""Checks the merged (factory) firmware image before a release publishes it.

The web flasher writes this one file at 0x0, for upgrades and fresh installs
alike. An upgrade keeps the saved Wi-Fi and settings only because the image
ends before LittleFS, so a release fails if it doesn't.

    python tools/release_image.py IMAGE BOOTLOADER PARTITIONS BOOT_APP0 APP
"""
import sys

LITTLEFS_START = 0x310000
OFFSETS = {"bootloader": 0x0, "partitions": 0x8000, "boot_app0": 0xE000, "app": 0x10000}


def check_layout(image, parts, limit=LITTLEFS_START):
    """Problems with `image`, or [] if it is good. `parts` maps names in
    OFFSETS to that part's bytes; each must sit at its offset, the app must be
    the last thing in the image, and the image must end by `limit`."""
    problems = []
    if len(image) > limit:
        problems.append(f"image ends at {len(image):#x}, past LittleFS at {limit:#x}")
    for name, data in parts.items():
        off = OFFSETS[name]
        if image[off:off + len(data)] != data:
            problems.append(f"{name} at {off:#x} does not match its .bin")
    app = parts.get("app")
    if app is not None and len(image) != OFFSETS["app"] + len(app):
        problems.append(f"image is {len(image)} bytes, expected {OFFSETS['app'] + len(app)} "
                        f"(the app at {OFFSETS['app']:#x} must be the last part)")
    return problems


def main(argv):
    if len(argv) != 6:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    with open(argv[1], "rb") as f:
        image = f.read()
    parts = {}
    for name, path in zip(["bootloader", "partitions", "boot_app0", "app"], argv[2:]):
        with open(path, "rb") as f:
            parts[name] = f.read()
    problems = check_layout(image, parts)
    for p in problems:
        print("FAIL:", p)
    if problems:
        return 1
    print(f"OK: {len(image)} bytes, ends at {len(image):#x}, below LittleFS at {LITTLEFS_START:#x}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
