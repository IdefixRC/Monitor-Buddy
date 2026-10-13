#!/usr/bin/env python3
"""Assembles the GitHub Pages site: the flasher (web/) plus a mirror of the
firmware of every release from 1.2.0 on, described by firmware/releases.json.

A browser can't download GitHub release assets (no CORS headers), so Pages
serves copies. The releases stay the source of truth; this rebuilds the
whole mirror from them every time.

    python tools/pages_site.py OUT_DIR     (needs an authenticated gh and the git tags)
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_URL = "https://github.com/IdefixRC/Monitor-Buddy"
FIRST_VERSION = (1, 2, 0)   # older firmware has no runtime settings
MANIFEST_FORMAT = 1
_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$")
_CFG = re.compile(r"static\s+const\s+int\s+CONFIG_VERSION\s*=\s*(\d+)\s*;")


def parse_tag(tag):
    """'v1.2.0' -> (1, 2, 0, None), 'v1.2.0-rc1' -> (1, 2, 0, 1), else None."""
    m = _TAG.match(tag)
    if not m:
        return None
    rc = int(m.group(4)) if m.group(4) else None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), rc)


def included(parsed):
    """1.2.0 and newer, release candidates included."""
    return parsed is not None and parsed[:3] >= FIRST_VERSION


def sort_key(parsed):
    """Sort with reverse=True for newest first; a final release ranks above its rcs."""
    major, minor, patch, rc = parsed
    return (major, minor, patch, 1 if rc is None else 0, rc or 0)


def parse_cfg_v(header_text):
    m = _CFG.search(header_text)
    if not m:
        raise ValueError("CONFIG_VERSION not found in lib/settings/settings.h")
    return int(m.group(1))


def asset_name(version):
    return f"monitor-buddy-{version}.bin"


def release_entry(tag, published_at, prerelease, data, cfg_v):
    version = tag[1:]
    return {"version": version, "date": published_at[:10], "prerelease": bool(prerelease),
            "file": f"firmware/{tag}/{asset_name(version)}", "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "cfg_v": cfg_v,
            "notes": f"{REPO_URL}/releases/tag/{tag}"}


def build_manifest(entries):
    """`entries` newest first. latest is the newest final release, or None while
    only release candidates exist. `format` is the schema version, so the shape
    can change later without breaking flashers that already shipped."""
    latest = next((e["version"] for e in entries if not e["prerelease"]), None)
    return {"format": MANIFEST_FORMAT, "latest": latest, "releases": list(entries)}


def effective_prerelease(is_prerelease, parsed):
    """An -rcN tag is always a pre-release, whatever the release page says."""
    return bool(is_prerelease) or parsed[3] is not None


def select(listed):
    """From `gh release list` rows to [(tag, release)], newest first. Drafts and
    versions before 1.2.0 are dropped; an -rcN tag gets isPrerelease forced on."""
    picked = []
    for r in listed:
        parsed = parse_tag(r["tagName"])
        if r["isDraft"] or not included(parsed):
            continue
        r = dict(r, isPrerelease=effective_prerelease(r["isPrerelease"], parsed))
        picked.append((sort_key(parsed), r["tagName"], r))
    picked.sort(key=lambda p: p[0], reverse=True)
    return [(tag, r) for _, tag, r in picked]


# Pages caches every file for 10 minutes, so right after a deploy a visitor
# could run a new app.js with old cached modules (hardware test 2026-10-12).
# Every code URL carries the site's version: a new deploy is new URLs.
# `from "./x.js"`, `import "./x.js"` and `import("./x.js")`; not `Array.from("./x.js")`.
_JS_IMPORT = re.compile(r"""((?:\bfrom\s*|\bimport\s*\(?\s*))(["'])(\.{1,2}/[^"'?#]+?\.m?js)\2""")
_HTML_REF = re.compile(r"""(\b(?:src|href)=)(["'])((?![a-z][a-z0-9+.-]*:|/)[^"'?#]+\.(?:m?js|css))\2""",
                       re.IGNORECASE)


def site_version(root):
    """A short hash of every file under `root`: it changes whenever the site does."""
    root = Path(root)
    h = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        h.update(path.relative_to(root).as_posix().encode() + b"\n" + path.read_bytes() + b"\n")
    return h.hexdigest()[:10]


def stamp_assets(root, version):
    """Appends ?v=<version> to every relative module import (in .js, .mjs and
    .html) and to the .js and .css links in the HTML. Every import of a module
    must carry the same URL, or the browser loads it twice. Data fetches are
    left alone. Running it again changes nothing. Returns the number of edits."""
    edits = 0

    def stamp(m):
        nonlocal edits
        edits += 1
        return f"{m.group(1)}{m.group(2)}{m.group(3)}?v={version}{m.group(2)}"

    for path in Path(root).rglob("*"):
        if path.suffix not in (".js", ".mjs", ".html") or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        new = _JS_IMPORT.sub(stamp, text)
        if path.suffix == ".html":
            new = _HTML_REF.sub(stamp, new)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="")
    return edits


def check_out_dir(repo, out):
    """Why `out` must not be wiped and rebuilt, or None when it is fine. main()
    deletes `out`, so it must never be the repo, one of its parents, web/ or .git/."""
    repo, out = Path(repo).resolve(), Path(out).resolve()
    if out == repo or out in repo.parents:
        return f"{out} is the repo root or an ancestor of it"
    for guarded in (repo / "web", repo / ".git"):
        if out == guarded or guarded in out.parents:
            return f"{out} is inside {guarded}"
    return None


def _run(args, cwd=None):
    """Runs a gh/git command; on failure prints its stderr, then re-raises."""
    try:
        return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        print(f"command failed ({e.returncode}): {' '.join(map(str, args))}\n{e.stderr}",
              file=sys.stderr)
        raise


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    repo = Path(__file__).resolve().parent.parent
    out = Path(argv[1]).resolve()
    problem = check_out_dir(repo, out)
    if problem:
        print(f"refusing to use that OUT_DIR: {problem}", file=sys.stderr)
        return 2

    listed = json.loads(_run(["gh", "release", "list", "--limit", "200", "--json",
                              "tagName,isPrerelease,isDraft,publishedAt"], cwd=repo).stdout)

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(repo / "web", out)
    version = site_version(out)
    print(f"site version {version}: {stamp_assets(out, version)} code URLs stamped")
    firmware = out / "firmware"
    firmware.mkdir(exist_ok=True)

    entries = []
    for tag, r in select(listed):
        name = asset_name(tag[1:])
        view = json.loads(_run(["gh", "release", "view", tag, "--json", "assets"],
                               cwd=repo).stdout)
        asset = next((a for a in view["assets"] if a["name"] == name), None)
        if asset is None:
            print(f"::warning::skipping {tag}: no {name} attached")
            continue
        dest = firmware / tag
        dest.mkdir(parents=True, exist_ok=True)
        _run(["gh", "release", "download", tag, "-p", name, "-D", str(dest), "--clobber"],
             cwd=repo)
        path = dest / name
        if not path.is_file():
            raise RuntimeError(f"{tag}: gh reported success but {name} is missing")
        data = path.read_bytes()
        digest = asset.get("digest") or ""
        if digest.startswith("sha256:") and digest[7:].lower() != hashlib.sha256(data).hexdigest():
            raise RuntimeError(f"{tag}: {name} does not match the release's sha256 digest")
        header = _run(["git", "show", f"{tag}:lib/settings/settings.h"], cwd=repo).stdout
        entries.append(release_entry(tag, r["publishedAt"], r["isPrerelease"],
                                     data, parse_cfg_v(header)))
        print(f"mirrored {tag} ({name})")

    manifest = build_manifest(entries)
    (firmware / "releases.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"releases.json: {len(entries)} release(s), latest {manifest['latest']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
