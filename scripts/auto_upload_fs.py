"""
auto_upload_fs.py  —  deploy the LittleFS image (data/) after a firmware upload,
but ONLY when data/ changed since the last FS upload.

Why the "only when changed" gate:
    AyresWiFiManager keeps the saved Wi-Fi credentials in /wifi.json on the SAME
    LittleFS partition as the portal HTML. `uploadfs` reflashes the whole
    partition from data/ (which has no wifi.json), so every FS upload wipes the
    stored credentials. Gating on a content hash means routine firmware flashes
    leave the filesystem — and your credentials — alone, while an edit to any
    file in data/ is picked up and pushed automatically on the next upload.

Manual overrides:
    - Force an FS upload any time:      pio run -t uploadfs
    - Disable this behaviour:           comment out `extra_scripts` in platformio.ini
    - Re-arm after a manual uploadfs:   handled automatically (stamp is refreshed)
"""

Import("env")

import hashlib
from pathlib import Path

project_dir = Path(env["PROJECT_DIR"])
data_dir = project_dir / "data"
stamp = Path(env.subst("$BUILD_DIR")) / "littlefs_data.sha1"


def _data_hash() -> str:
    h = hashlib.sha1()
    if data_dir.is_dir():
        for f in sorted(p for p in data_dir.rglob("*") if p.is_file()):
            h.update(f.relative_to(data_dir).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def _after_upload(source, target, env):
    current = _data_hash()
    previous = stamp.read_text().strip() if stamp.exists() else ""

    if current == previous:
        print("[auto-fs] data/ unchanged since last FS upload - skipping uploadfs")
        return

    print("[auto-fs] data/ changed - uploading LittleFS image "
          "(this replaces /wifi.json; re-provision Wi-Fi if needed)...")
    rc = env.Execute(
        f'"$PYTHONEXE" -m platformio run -e {env["PIOENV"]} -t uploadfs'
    )
    if rc == 0:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(current)
        print("[auto-fs] LittleFS image uploaded.")
    else:
        print(f"[auto-fs] uploadfs FAILED (exit {rc}) - firmware is flashed, "
              f"filesystem is not. Run 'pio run -t uploadfs' manually.")


env.AddPostAction("upload", _after_upload)
