import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStock, checkGithub, checkCoin } from "../web/js/checks.js";

// A fake fetch that records the URLs it was given and answers with one reply,
// or throws for a network error.
function fake(reply) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    if (reply instanceof Error) throw reply;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  fn.urls = urls;
  return fn;
}
const down = () => fake(new TypeError("Failed to fetch"));

// -- stock ------------------------------------------------------------------

test("stock: 200 with a price is ok", async () => {
  assert.deepEqual(await checkStock(fake({ status: 200, body: { c: 1234.56 } }), "AVGO", "key1"),
    { status: "ok", price: 1234.56, open: 0, high: 0, low: 0, ref: 0 });
});
test("stock: 200 with c = 0 is ticker_not_found", async () => {
  assert.deepEqual(await checkStock(fake({ status: 200, body: { c: 0 } }), "NOPE", "key1"),
    { status: "ticker_not_found" });
});
test("stock: 200 without c is ticker_not_found", async () => {
  assert.deepEqual(await checkStock(fake({ status: 200, body: {} }), "NOPE", "key1"),
    { status: "ticker_not_found" });
});
test("stock: 401 is key_rejected", async () => {
  assert.deepEqual(await checkStock(fake({ status: 401, body: { error: "Invalid API key" } }), "AAPL", "bad"),
    { status: "key_rejected" });
});
test("stock: 403 (a symbol the free plan doesn't cover) is ticker_not_found", async () => {
  assert.deepEqual(await checkStock(fake({ status: 403, body: { error: "no access" } }), "7203.T", "key1"),
    { status: "ticker_not_found" });
});
test("stock: 429 is rate_limited", async () => {
  assert.deepEqual(await checkStock(fake({ status: 429, body: {} }), "AAPL", "key1"),
    { status: "rate_limited" });
});
test("stock: a thrown error is network", async () => {
  assert.deepEqual(await checkStock(down(), "AAPL", "key1"), { status: "network" });
});
test("stock: a server error is network", async () => {
  assert.deepEqual(await checkStock(fake({ status: 503, body: {} }), "AAPL", "key1"), { status: "network" });
});
test("stock: an answer that is not JSON is network", async () => {
  const fn = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
  assert.deepEqual(await checkStock(fn, "AAPL", "key1"), { status: "network" });
});
test("stock: the URL is exact and encoded", async () => {
  const f = fake({ status: 200, body: { c: 1 } });
  await checkStock(f, "BRK.B", "k&e y");
  assert.deepEqual(f.urls, ["https://finnhub.io/api/v1/quote?symbol=BRK.B&token=k%26e%20y"]);
});
test("stock: the ticker is encoded too", async () => {
  const f = fake({ status: 200, body: { c: 1 } });
  await checkStock(f, "A&B=C", "key1");
  assert.deepEqual(f.urls, ["https://finnhub.io/api/v1/quote?symbol=A%26B%3DC&token=key1"]);
});

// -- github -----------------------------------------------------------------

test("github: 200 gives followers and repos", async () => {
  assert.deepEqual(await checkGithub(fake({ status: 200, body: { followers: 42, public_repos: 17 } }), "IdefixRC"),
    { status: "ok", followers: 42, repos: 17 });
});
test("github: 404 is not_found", async () => {
  assert.deepEqual(await checkGithub(fake({ status: 404, body: {} }), "nobody-here"), { status: "not_found" });
});
test("github: 403 is rate_limited", async () => {
  assert.deepEqual(await checkGithub(fake({ status: 403, body: {} }), "IdefixRC"), { status: "rate_limited" });
});
test("github: 429 is rate_limited", async () => {
  assert.deepEqual(await checkGithub(fake({ status: 429, body: {} }), "IdefixRC"), { status: "rate_limited" });
});
test("github: a thrown error is network", async () => {
  assert.deepEqual(await checkGithub(down(), "IdefixRC"), { status: "network" });
});
test("github: a server error is network", async () => {
  assert.deepEqual(await checkGithub(fake({ status: 500, body: {} }), "IdefixRC"), { status: "network" });
});
test("github: the URL is exact and encoded", async () => {
  const f = fake({ status: 200, body: { followers: 0, public_repos: 0 } });
  await checkGithub(f, "octo cat/x");
  assert.deepEqual(f.urls, ["https://api.github.com/users/octo%20cat%2Fx"]);
});

test("checkCoin: Coinbase stats, 404 is not found", async () => {
  const ok = async (url) => (assert.match(url, /exchange\.coinbase\.com\/products\/SOL-EUR\/stats$/), { ok: true, status: 200, json: async () => ({ last: "123.45" }) });
  assert.deepEqual(await checkCoin(ok, "coinbase", "SOL-EUR", ""), { status: "ok", price: 123.45, open: 0, high: 0, low: 0, ref: 0 });
  assert.equal((await checkCoin(async () => ({ ok: false, status: 404 }), "coinbase", "X-Y", "")).status, "not_found");
});

test("checkCoin: Finnhub quote via COINBASE:, zeros are not found", async () => {
  const z = async (url) => (assert.match(url, /symbol=COINBASE%3ASOL-EUR/), { ok: true, status: 200, json: async () => ({ c: 0 }) });
  assert.equal((await checkCoin(z, "finnhub", "SOL-EUR", "k")).status, "not_found");
});

test("checkCoin: bad key and network", async () => {
  assert.equal((await checkCoin(async () => ({ ok: false, status: 401 }), "finnhub", "SOL-EUR", "k")).status, "bad_key");
  assert.equal((await checkCoin(async () => ({ ok: false, status: 403 }), "finnhub", "SOL-EUR", "k")).status, "not_found");
  assert.equal((await checkCoin(async () => { throw new Error("x"); }, "coinbase", "SOL-EUR", "")).status, "network");
  assert.equal((await checkCoin(async () => ({ ok: false, status: 500 }), "coinbase", "SOL-EUR", "")).status, "network");
  assert.deepEqual(await checkCoin(async () => ({ ok: true, status: 200, json: async () => ({ c: 9.5 }) }), "finnhub", "SOL-EUR", "k"), { status: "ok", price: 9.5, open: 0, high: 0, low: 0, ref: 0 });
});

test("checkCoin: a pair with / or ? is encoded in the Coinbase URL", async () => {
  const seen = [];
  const f = async (url) => (seen.push(url), { ok: false, status: 404 });
  await checkCoin(f, "coinbase", "A/B-C?D", "");
  assert.match(seen[0], /products\/A%2FB-C%3FD\/stats$/);
});

test("checkCoin brings the numbers the coin page draws", async () => {
  const cb = async () => ({ ok: true, status: 200, json: async () => ({ last: "100", open: "90", high: "110", low: "85" }) });
  assert.deepEqual(await checkCoin(cb, "coinbase", "BTC-USD", ""), { status: "ok", price: 100, open: 90, high: 110, low: 85, ref: 90 });
  const fh = async () => ({ ok: true, status: 200, json: async () => ({ c: 100, o: 95, h: 110, l: 85, pc: 90 }) });
  assert.deepEqual(await checkCoin(fh, "finnhub", "BTC-USD", "k"), { status: "ok", price: 100, open: 95, high: 110, low: 85, ref: 90 });
  const noClose = async () => ({ ok: true, status: 200, json: async () => ({ c: 100, o: 95, h: 110, l: 85, pc: 0 }) });
  assert.equal((await checkCoin(noClose, "finnhub", "BTC-USD", "k")).ref, 95);
});
