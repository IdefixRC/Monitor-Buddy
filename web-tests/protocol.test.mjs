import { test } from "node:test";
import assert from "node:assert/strict";
import { PREFIX, MAX_ID, makeIdSource, requestLine, LineSplitter, parseReply, answers } from "../web/js/protocol.js";

test("ids start at the given value, increase and wrap", () => {
  const next = makeIdSource(MAX_ID - 1);
  assert.equal(next(), MAX_ID - 1);
  assert.equal(next(), MAX_ID);
  assert.equal(next(), 0);
});

test("request line puts id first and drops a body id", () => {
  assert.equal(requestLine("INFO", 7), '@MB INFO {"id":7}\n');
  assert.equal(requestLine("SET", 8, { id: 99, config: { ticker: "AVGO" } }),
               '@MB SET {"id":8,"config":{"ticker":"AVGO"}}\n');
});

test("line splitter keeps partial lines and strips CR", () => {
  const s = new LineSplitter();
  assert.deepEqual(s.push("app=0 mo"), []);
  assert.deepEqual(s.push("od=0\r\n@MB {\"ok\":true}\npart"), ["app=0 mood=0", '@MB {"ok":true}']);
  assert.deepEqual(s.push("ial\n"), ["partial"]);
});

test("parseReply accepts only prefixed JSON objects", () => {
  assert.deepEqual(parseReply('@MB {"ok":true,"cmd":"GET","id":3}'), { ok: true, cmd: "GET", id: 3 });
  assert.equal(parseReply("app=0 mood=0 wifi=up"), null);
  assert.equal(parseReply("@MB {broken"), null);
  assert.equal(parseReply("@MB [1,2]"), null);
  assert.equal(parseReply('xx@MB {"ok":true}'), null);
  assert.equal(PREFIX, "@MB ");
});

test("answers matches cmd and id, plus the three id-less errors", () => {
  assert.ok(answers({ ok: true, cmd: "GET", id: 5 }, "GET", 5));
  assert.ok(!answers({ ok: true, cmd: "GET", id: 4 }, "GET", 5));          // stale
  assert.ok(!answers({ ok: true, cmd: "INFO", id: 5 }, "GET", 5));         // wrong command
  for (const error of ["line too long", "bad json", "restarting"])
    assert.ok(answers({ ok: false, cmd: "SET", error }, "SET", 5), error);
  assert.ok(!answers({ ok: false, cmd: "SET", error: "unknown command" }, "SET", 5));
  assert.ok(!answers({ ok: false, cmd: "SET", id: 4, error: "restarting" }, "SET", 5));
});
