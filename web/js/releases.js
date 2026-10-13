// The release manifest (firmware/releases.json, built by tools/pages_site.py).
// Pure: no network here.

export class UnknownFormat extends Error {
  constructor(message) { super(message); this.name = "UnknownFormat"; }
}

// Same pattern as the release tags in tools/pages_site.py, minus the "v".
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/;

// "1.2.0-rc1" -> [1, 2, 0, 0, 1]; "1.2.0" -> [1, 2, 0, 1, 0] (a final ranks
// above its rcs). Null for "dev" or anything else that isn't a version.
function parseVersion(v) {
  if (typeof v !== "string") return null;
  const m = VERSION.exec(v.startsWith("v") ? v.slice(1) : v);
  if (!m) return null;
  const rc = m[4] === undefined ? null : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), rc === null ? 1 : 0, rc ?? 0];
}

// -1, 0 or 1. An rc is below its final; "dev" (or any text that is not a
// version) is below every real version.
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

export function parseManifest(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json) || json.format !== 1) {
    throw new UnknownFormat("This flasher doesn't understand the firmware list's format");
  }
  if (!Array.isArray(json.releases)) throw new UnknownFormat("The firmware list has no releases");
  return json;
}

// Entries a user may pick, newest first; release candidates only with `beta`.
// Entries whose version can't be read are left out. The manifest is not changed.
export function offered(manifest, beta) {
  return manifest.releases
    .filter((e) => parseVersion(e.version) && (beta || !e.prerelease))
    .sort((x, y) => compareVersions(y.version, x.version));
}

export function newest(manifest, beta) {
  return offered(manifest, beta)[0] ?? null;
}

// The newest offered entry above the installed firmware; null when there is
// none, or when the installed version is "dev" or unreadable (a source build
// is never nagged).
export function updateFor(installedFw, manifest, beta) {
  if (!parseVersion(installedFw)) return null;
  const top = newest(manifest, beta);
  return top && compareVersions(top.version, installedFw) > 0 ? top : null;
}
