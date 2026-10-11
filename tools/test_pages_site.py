import hashlib
import unittest

import pages_site as ps

HEADER = """#pragma once
static const int CONFIG_VERSION = 1;
static const uint8_t SETTINGS_PAGE_COUNT = 7;
"""


class Tags(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(ps.parse_tag("v1.2.0"), (1, 2, 0, None))
        self.assertEqual(ps.parse_tag("v1.2.0-rc1"), (1, 2, 0, 1))
        self.assertEqual(ps.parse_tag("v10.0.3-rc12"), (10, 0, 3, 12))

    def test_parse_rejects_other_tags(self):
        for tag in ["v1.0", "1.2.0", "v1.2.0-beta", "v1.2.0rc1", "v1.2", "latest", ""]:
            self.assertIsNone(ps.parse_tag(tag), tag)

    def test_included_from_1_2_0(self):
        self.assertTrue(ps.included(ps.parse_tag("v1.2.0")))
        self.assertTrue(ps.included(ps.parse_tag("v1.2.0-rc1")))
        self.assertTrue(ps.included(ps.parse_tag("v2.0.0")))
        self.assertFalse(ps.included(ps.parse_tag("v1.1.0")))
        self.assertFalse(ps.included(ps.parse_tag("v1.0.2")))
        self.assertFalse(ps.included(None))

    def test_newest_first(self):
        tags = ["v1.2.0-rc1", "v1.2.1", "v1.2.0", "v1.2.0-rc2", "v1.3.0-rc1"]
        ordered = sorted(tags, key=lambda t: ps.sort_key(ps.parse_tag(t)), reverse=True)
        self.assertEqual(ordered, ["v1.3.0-rc1", "v1.2.1", "v1.2.0", "v1.2.0-rc2", "v1.2.0-rc1"])


class CfgV(unittest.TestCase):
    def test_reads_config_version(self):
        self.assertEqual(ps.parse_cfg_v(HEADER), 1)
        self.assertEqual(ps.parse_cfg_v("static const int  CONFIG_VERSION =  12 ;"), 12)

    def test_missing_raises(self):
        with self.assertRaises(ValueError):
            ps.parse_cfg_v("#pragma once\n")


class Manifest(unittest.TestCase):
    def test_entry(self):
        e = ps.release_entry("v1.2.0-rc1", "2026-10-20T08:15:00Z", True, b"abc", 1)
        self.assertEqual(e, {
            "version": "1.2.0-rc1", "date": "2026-10-20", "prerelease": True,
            "file": "firmware/v1.2.0-rc1/monitor-buddy-1.2.0-rc1.bin",
            "size": 3, "sha256": hashlib.sha256(b"abc").hexdigest(), "cfg_v": 1,
            "notes": "https://github.com/IdefixRC/Monitor-Buddy/releases/tag/v1.2.0-rc1"})

    def test_asset_name(self):
        self.assertEqual(ps.asset_name("1.2.0"), "monitor-buddy-1.2.0.bin")

    def test_latest_is_newest_final(self):
        entries = [ps.release_entry("v1.3.0-rc1", "2026-11-01T00:00:00Z", True, b"x", 1),
                   ps.release_entry("v1.2.1", "2026-10-25T00:00:00Z", False, b"x", 1),
                   ps.release_entry("v1.2.0", "2026-10-20T00:00:00Z", False, b"x", 1)]
        m = ps.build_manifest(entries)
        self.assertEqual(m["latest"], "1.2.1")
        self.assertEqual([e["version"] for e in m["releases"]], ["1.3.0-rc1", "1.2.1", "1.2.0"])

    def test_latest_is_null_with_only_prereleases(self):
        m = ps.build_manifest([ps.release_entry("v1.2.0-rc1", "2026-10-20T00:00:00Z", True, b"x", 1)])
        self.assertIsNone(m["latest"])

    def test_empty(self):
        self.assertEqual(ps.build_manifest([]), {"latest": None, "releases": []})


if __name__ == "__main__":
    unittest.main()
