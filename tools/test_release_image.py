import unittest

import release_image as ri

PARTS = {"bootloader": b"B" * 100, "partitions": b"P" * 64,
         "boot_app0": b"\x00" * 32, "app": b"A" * 1000}


def make(parts):
    """An image with each part at its offset and 0xFF in the gaps."""
    img = bytearray(b"\xff" * (ri.OFFSETS["app"] + len(parts["app"])))
    for name, data in parts.items():
        off = ri.OFFSETS[name]
        img[off:off + len(data)] = data
    return bytes(img)


class CheckLayout(unittest.TestCase):
    def test_good_image(self):
        self.assertEqual(ri.check_layout(make(PARTS), PARTS), [])

    def test_ending_exactly_at_littlefs_is_ok(self):
        edge = dict(PARTS, app=b"A" * (ri.LITTLEFS_START - ri.OFFSETS["app"]))
        self.assertEqual(ri.check_layout(make(edge), edge), [])

    def test_past_littlefs_fails(self):
        big = dict(PARTS, app=b"A" * (ri.LITTLEFS_START - ri.OFFSETS["app"] + 1))
        problems = ri.check_layout(make(big), big)
        self.assertTrue(any("past LittleFS" in p for p in problems), problems)

    def test_mismatched_part_fails(self):
        img = bytearray(make(PARTS))
        img[ri.OFFSETS["partitions"]] = 0
        problems = ri.check_layout(bytes(img), PARTS)
        self.assertTrue(any("partitions" in p for p in problems), problems)

    def test_trailing_bytes_fail(self):
        problems = ri.check_layout(make(PARTS) + b"\xff", PARTS)
        self.assertTrue(any("expected" in p for p in problems), problems)

    def test_usage(self):
        self.assertEqual(ri.main(["release_image.py"]), 2)


if __name__ == "__main__":
    unittest.main()
