import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseManifest, compareVersions, offered, newest, updateFor, UnknownFormat,
} from "../web/js/releases.js";

const entry = (version, prerelease = false) => ({ version, prerelease, date: "2026-10-20",
  file: `firmware/v${version}/monitor-buddy-${version}.bin`, size: 1, sha256: "00", cfg_v: 1, notes: "" });
const manifest = (...entries) => ({ format: 1, latest: null, releases: entries });
const versions = (list) => list.map((e) => e.version);

// -- parseManifest ----------------------------------------------------------

test("format 1 is accepted", () => {
  const m = parseManifest({ format: 1, latest: "1.2.0", releases: [entry("1.2.0")] });
  assert.equal(m.format, 1);
  assert.deepEqual(versions(m.releases), ["1.2.0"]);
});
test("format 2 is rejected", () => {
  assert.throws(() => parseManifest({ format: 2, latest: null, releases: [] }), UnknownFormat);
});
test("a missing format is rejected", () => {
  assert.throws(() => parseManifest({ latest: null, releases: [] }), UnknownFormat);
});
test("a non-object is rejected", () => {
  assert.throws(() => parseManifest(null), UnknownFormat);
  assert.throws(() => parseManifest([]), UnknownFormat);
});
test("releases that is not a list is rejected", () => {
  assert.throws(() => parseManifest({ format: 1, latest: null, releases: "x" }), UnknownFormat);
});
test("UnknownFormat is an Error with its own name", () => {
  try { parseManifest({ format: 2 }); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof Error); assert.equal(e.name, "UnknownFormat"); }
});

// -- compareVersions --------------------------------------------------------

test("1.2.1 is above 1.2.0", () => assert.equal(compareVersions("1.2.1", "1.2.0"), 1));
test("1.2.0 is below 1.2.1", () => assert.equal(compareVersions("1.2.0", "1.2.1"), -1));
test("equal versions compare 0", () => assert.equal(compareVersions("1.2.0", "1.2.0"), 0));
test("equal release candidates compare 0", () => assert.equal(compareVersions("1.2.0-rc2", "1.2.0-rc2"), 0));
test("an rc is below its final", () => assert.equal(compareVersions("1.2.0-rc2", "1.2.0"), -1));
test("a final is above its rc", () => assert.equal(compareVersions("1.2.0", "1.2.0-rc2"), 1));
test("rc2 is above rc1", () => assert.equal(compareVersions("1.2.0-rc2", "1.2.0-rc1"), 1));
test("rc10 is above rc9 (numeric, not text)", () => assert.equal(compareVersions("1.2.0-rc10", "1.2.0-rc9"), 1));
test("1.10.0 is above 1.9.0 (numeric, not text)", () => assert.equal(compareVersions("1.10.0", "1.9.0"), 1));
test("1.3.0-rc1 is above 1.2.1", () => assert.equal(compareVersions("1.3.0-rc1", "1.2.1"), 1));
test("dev is below everything", () => {
  assert.equal(compareVersions("dev", "1.2.0-rc1"), -1);
  assert.equal(compareVersions("1.2.0-rc1", "dev"), 1);
  assert.equal(compareVersions("dev", "0.0.1"), -1);
});
test("dev equals dev", () => assert.equal(compareVersions("dev", "dev"), 0));
test("sorting gives 1.3.0-rc1 > 1.2.1 > 1.2.0 > 1.2.0-rc2 > 1.2.0-rc1 > dev", () => {
  const shuffled = ["1.2.0", "dev", "1.2.0-rc1", "1.3.0-rc1", "1.2.0-rc2", "1.2.1"];
  assert.deepEqual(shuffled.sort((a, b) => compareVersions(b, a)),
    ["1.3.0-rc1", "1.2.1", "1.2.0", "1.2.0-rc2", "1.2.0-rc1", "dev"]);
});

// -- offered / newest -------------------------------------------------------

const MIXED = manifest(entry("1.2.1-rc1", true), entry("1.2.0"), entry("1.2.0-rc1", true));

test("offered without beta lists final releases only", () => {
  assert.deepEqual(versions(offered(MIXED, false)), ["1.2.0"]);
});
test("offered with beta lists everything, newest first", () => {
  assert.deepEqual(versions(offered(MIXED, true)), ["1.2.1-rc1", "1.2.0", "1.2.0-rc1"]);
});
test("offered sorts newest first whatever the manifest order", () => {
  const m = manifest(entry("1.2.0"), entry("1.2.1"), entry("1.2.0-rc1", true));
  assert.deepEqual(versions(offered(m, true)), ["1.2.1", "1.2.0", "1.2.0-rc1"]);
});
test("offered does not change the manifest", () => {
  offered(MIXED, true);
  assert.deepEqual(versions(MIXED.releases), ["1.2.1-rc1", "1.2.0", "1.2.0-rc1"]);
});
test("newest without beta is the newest final", () => {
  assert.equal(newest(MIXED, false).version, "1.2.0");
});
test("newest with beta is the newest of all", () => {
  assert.equal(newest(MIXED, true).version, "1.2.1-rc1");
});
test("newest without beta on an rc-only manifest is null", () => {
  assert.equal(newest(manifest(entry("1.2.0-rc1", true)), false), null);
});
test("newest on an empty manifest is null", () => {
  assert.equal(newest(manifest(), true), null);
});

// -- updateFor --------------------------------------------------------------

const WITH_121 = manifest(entry("1.2.1"), entry("1.2.0"), entry("1.2.0-rc1", true));

test("1.2.0 is offered 1.2.1", () => assert.equal(updateFor("1.2.0", WITH_121, false).version, "1.2.1"));
test("1.2.1 has no update", () => assert.equal(updateFor("1.2.1", WITH_121, false), null));
test("a newer-than-published install has no update", () => assert.equal(updateFor("1.3.0", WITH_121, false), null));
test("dev never gets an update", () => assert.equal(updateFor("dev", WITH_121, true), null));
test("an unparseable version never gets an update", () => {
  assert.equal(updateFor("banana", WITH_121, true), null);
  assert.equal(updateFor("", WITH_121, true), null);
  assert.equal(updateFor(undefined, WITH_121, true), null);
});
test("a release candidate is offered its final", () => {
  const m = manifest(entry("1.2.0"), entry("1.2.0-rc1", true));
  assert.equal(updateFor("1.2.0-rc1", m, false).version, "1.2.0");
});
test("beta users are offered a newer release candidate", () => {
  const m = manifest(entry("1.3.0-rc1", true), entry("1.2.1"));
  assert.equal(updateFor("1.2.1", m, true).version, "1.3.0-rc1");
});
test("non-beta users are not offered a release candidate", () => {
  const m = manifest(entry("1.3.0-rc1", true), entry("1.2.1"));
  assert.equal(updateFor("1.2.1", m, false), null);
});
test("a v prefix on the installed version is tolerated", () => {
  assert.equal(updateFor("v1.2.0", WITH_121, false).version, "1.2.1");
});
