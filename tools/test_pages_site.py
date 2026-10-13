import contextlib
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

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
        self.assertEqual(ps.build_manifest([]), {"format": 1, "latest": None, "releases": []})

    def test_format_is_the_first_key(self):
        self.assertEqual(next(iter(ps.build_manifest([]))), "format")


def row(tag, pre=False, draft=False, published="2026-10-20T08:15:00Z"):
    return {"tagName": tag, "isPrerelease": pre, "isDraft": draft, "publishedAt": published}


class Select(unittest.TestCase):
    def test_drops_drafts_and_old_tags_and_sorts(self):
        listed = [row("v1.2.0-rc1", True), row("v1.1.0"), row("v1.2.1", draft=True),
                  row("v1.2.0"), row("v1.0.2"), row("nightly"), row("v1.3.0-rc1", True)]
        self.assertEqual([t for t, _ in ps.select(listed)],
                         ["v1.3.0-rc1", "v1.2.0", "v1.2.0-rc1"])

    def test_rc_without_prerelease_flag_is_flagged(self):
        got = dict(ps.select([row("v1.2.0-rc1", pre=False)]))
        self.assertTrue(got["v1.2.0-rc1"]["isPrerelease"])
        self.assertFalse(dict(ps.select([row("v1.2.0")]))["v1.2.0"]["isPrerelease"])

    def test_effective_prerelease(self):
        self.assertTrue(ps.effective_prerelease(False, ps.parse_tag("v1.2.0-rc2")))
        self.assertTrue(ps.effective_prerelease(True, ps.parse_tag("v1.2.0")))
        self.assertFalse(ps.effective_prerelease(False, ps.parse_tag("v1.2.0")))


class OutDirGuard(unittest.TestCase):
    def test_refuses_repo_ancestors_web_and_git(self):
        repo = Path(ps.__file__).resolve().parent.parent
        for bad in (repo, repo.parent, repo / "web", repo / "web" / "x", repo / ".git",
                    repo / ".git" / "y"):
            self.assertIsNotNone(ps.check_out_dir(repo, bad), bad)

    def test_allows_other_places(self):
        repo = Path(ps.__file__).resolve().parent.parent
        self.assertIsNone(ps.check_out_dir(repo, repo / "_site"))
        with tempfile.TemporaryDirectory() as t:
            self.assertIsNone(ps.check_out_dir(repo, Path(t) / "site"))


class RunHelper(unittest.TestCase):
    def test_failure_prints_stderr_and_reraises(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(subprocess.CalledProcessError):
            ps._run([sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"])
        self.assertIn("boom", err.getvalue())


class Main(unittest.TestCase):
    """main() with a fake _run: no gh, no git, no network, no real repo writes."""

    def setUp(self):
        self._real_run = ps._run
        self.addCleanup(setattr, ps, "_run", self._real_run)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "site"
        self.calls = []

    def fake(self, releases, files, digests=None, fail_download=False, attach=True):
        """releases: list of gh list rows; files: tag -> bytes."""
        digests = digests or {}

        def run(args, cwd=None):
            self.calls.append(args)
            if args[:3] == ["gh", "release", "list"]:
                return subprocess.CompletedProcess(args, 0, json.dumps(releases), "")
            if args[:3] == ["gh", "release", "view"]:
                tag = args[3]
                name = ps.asset_name(tag[1:])
                assets = [{"name": "Monitor-Buddy-x.zip"}]
                if attach and tag in files:
                    a = {"name": name}
                    if tag in digests:
                        a["digest"] = digests[tag]
                    assets.append(a)
                return subprocess.CompletedProcess(args, 0, json.dumps({"assets": assets}), "")
            if args[:3] == ["gh", "release", "download"]:
                if fail_download:
                    raise subprocess.CalledProcessError(1, args, "", "HTTP 502")
                tag, dest = args[3], Path(args[args.index("-D") + 1])
                (dest / args[args.index("-p") + 1]).write_bytes(files[tag])
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "git" and args[1] == "show":
                return subprocess.CompletedProcess(args, 0, HEADER, "")
            raise AssertionError(args)
        ps._run = run

    def run_main(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = ps.main(["pages_site.py", str(self.out)])
        return rc, out.getvalue(), err.getvalue()

    def test_writes_bins_and_manifest(self):
        self.fake([row("v1.2.0", published="2026-10-20T08:15:00Z"),
                   row("v1.3.0-rc1", pre=False, published="2026-11-01T00:00:00Z"),
                   row("v1.1.0")],
                  {"v1.2.0": b"final", "v1.3.0-rc1": b"candidate"})
        rc, _, _ = self.run_main()
        self.assertEqual(rc, 0)
        fw = self.out / "firmware"
        self.assertEqual((fw / "v1.2.0" / "monitor-buddy-1.2.0.bin").read_bytes(), b"final")
        self.assertTrue((self.out / "index.html").is_file())
        m = json.loads((fw / "releases.json").read_text(encoding="utf-8"))
        self.assertEqual(list(m)[0], "format")
        self.assertEqual(m["format"], 1)
        self.assertEqual(m["latest"], "1.2.0")
        self.assertEqual([e["version"] for e in m["releases"]], ["1.3.0-rc1", "1.2.0"])
        self.assertTrue(m["releases"][0]["prerelease"])
        self.assertEqual(m["releases"][1]["sha256"], hashlib.sha256(b"final").hexdigest())
        self.assertEqual(m["releases"][1]["cfg_v"], 1)

    def test_matching_digest_is_accepted(self):
        d = "sha256:" + hashlib.sha256(b"final").hexdigest()
        self.fake([row("v1.2.0")], {"v1.2.0": b"final"}, digests={"v1.2.0": d})
        self.assertEqual(self.run_main()[0], 0)

    def test_missing_asset_is_skipped_with_a_warning(self):
        self.fake([row("v1.2.0")], {"v1.2.0": b"x"}, attach=False)
        rc, out, _ = self.run_main()
        self.assertEqual(rc, 0)
        self.assertIn("::warning::", out)
        self.assertIn("v1.2.0", out)
        m = json.loads((self.out / "firmware" / "releases.json").read_text(encoding="utf-8"))
        self.assertEqual(m["releases"], [])

    def test_failed_download_raises(self):
        self.fake([row("v1.2.0")], {"v1.2.0": b"x"}, fail_download=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_main()

    def test_digest_mismatch_raises(self):
        self.fake([row("v1.2.0")], {"v1.2.0": b"x"}, digests={"v1.2.0": "sha256:" + "0" * 64})
        with self.assertRaises(RuntimeError):
            self.run_main()

    def test_guard_refuses_the_repo_root(self):
        self.fake([], {})
        repo = Path(ps.__file__).resolve().parent.parent
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = ps.main(["pages_site.py", str(repo)])
        self.assertEqual(rc, 2)
        self.assertIn("refusing", err.getvalue())
        self.assertEqual(self.calls, [])
        self.assertTrue((repo / "web" / "index.html").is_file())



# ── Versioned code URLs (hardware test 2026-10-12, finding F) ──
# Pages caches for 10 minutes. Without a version in the URLs, a visitor could
# run a new app.js with old cached modules and fail mid-flash.

RELATIVE_JS = r"""(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}/[^"']+?\.m?js(?:\?[^"']*)?)["']"""


def write_site(root):
    files = {
        "index.html": '<link rel="icon" href="data:image/svg+xml,x.js">\n'
                      '<link rel="stylesheet" href="css/app.css">\n'
                      '<link rel="modulepreload" href="js/app.js">\n'
                      '<a href="https://example.com/a.js">x</a>\n'
                      '<script type="module" src="js/app.js"></script>\n',
        "dev.html": '<script type="module">\nimport { BuddyPort } from "./js/a.js";\n</script>\n',
        "js/app.js": 'import { a } from "./a.js";\nimport {\n  b,\n} from "./b.js";\n'
                     'const fake = await import("./fake.js");\nfetch("firmware/releases.json");\n',
        "js/a.js": 'import { E } from "../vendor/lib/bundle.js";\nexport const a = E;\n',
        "js/b.js": "export const b = 2;\n",
        "js/fake.js": "export default 3;\n",
        "vendor/lib/bundle.js": "export const E = 1;\n",
        "css/app.css": "body { color: red; }\n",
    }
    for rel, text in files.items():
        p = Path(root) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def specifiers(root):
    found = []
    for p in Path(root).rglob("*"):
        if p.suffix in (".js", ".mjs", ".html"):
            import re
            found += re.findall(RELATIVE_JS, p.read_text(encoding="utf-8"))
    return found


class StampAssets(unittest.TestCase):
    def test_version_follows_the_content(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            write_site(a)
            write_site(b)
            va = ps.site_version(Path(a))
            self.assertRegex(va, r"^[0-9a-f]{10}$")
            self.assertEqual(va, ps.site_version(Path(b)))
            (Path(b) / "js/b.js").write_text("export const b = 3;\n", encoding="utf-8")
            self.assertNotEqual(va, ps.site_version(Path(b)))

    def test_every_relative_import_carries_the_version(self):
        with tempfile.TemporaryDirectory() as d:
            write_site(d)
            ps.stamp_assets(Path(d), "abc1234567")
            found = specifiers(d)
            self.assertEqual(len(found), 5)  # app: a, b, fake; a: bundle; dev: a
            for spec in found:
                self.assertTrue(spec.endswith("?v=abc1234567"), spec)

    def test_html_code_links_carry_the_version_and_nothing_else_changes(self):
        with tempfile.TemporaryDirectory() as d:
            write_site(d)
            ps.stamp_assets(Path(d), "abc1234567")
            html = (Path(d) / "index.html").read_text(encoding="utf-8")
            self.assertIn('href="css/app.css?v=abc1234567"', html)
            self.assertIn('href="js/app.js?v=abc1234567"', html)
            self.assertIn('src="js/app.js?v=abc1234567"', html)
            self.assertIn('href="data:image/svg+xml,x.js"', html)
            self.assertIn('href="https://example.com/a.js"', html)
            app = (Path(d) / "js/app.js").read_text(encoding="utf-8")
            self.assertIn('fetch("firmware/releases.json")', app)

    def test_a_from_call_is_not_an_import(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.js"
            p.write_text('const a = Array.from("./data.js");\nimport { b } from "./b.js";\n', encoding="utf-8")
            ps.stamp_assets(Path(d), "abc1234567")
            text = p.read_text(encoding="utf-8")
            self.assertIn('Array.from("./data.js")', text)
            self.assertIn('from "./b.js?v=abc1234567"', text)

    def test_stamping_twice_changes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            write_site(d)
            ps.stamp_assets(Path(d), "abc1234567")
            before = {p: p.read_bytes() for p in Path(d).rglob("*") if p.is_file()}
            ps.stamp_assets(Path(d), "abc1234567")
            self.assertEqual(before, {p: p.read_bytes() for p in Path(d).rglob("*") if p.is_file()})

    def test_the_real_site_has_no_unversioned_import_left(self):
        repo = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "site"
            shutil.copytree(repo / "web", out)
            ps.stamp_assets(out, "abc1234567")
            found = specifiers(out)
            self.assertGreater(len(found), 15)
            self.assertEqual([s for s in found if not s.endswith("?v=abc1234567")], [])
            html = (out / "index.html").read_text(encoding="utf-8")
            self.assertEqual(html.count("?v=abc1234567"), 3)  # app.css, modulepreload, script


if __name__ == "__main__":
    unittest.main()
