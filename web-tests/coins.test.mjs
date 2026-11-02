import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STABLECOINS, parseCoinbaseProducts, parseFinnhubSymbols, quotesFor, defaultQuote, splitPair, searchCoins, loadCoinList } from "../web/js/coins.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

test("Coinbase: online pairs only, stablecoins left out as coins, USD first", () => {
  const list = parseCoinbaseProducts(fx("coinbase-products.json"));
  assert.deepEqual([...list.keys()], ["BTC", "ETH", "FOO", "SHIB", "SOL"]);
  assert.deepEqual(quotesFor(list, "BTC"), ["USD", "EUR", "GBP"]);
  assert.deepEqual(quotesFor(list, "FOO"), ["EUR"]);
  assert.equal(defaultQuote(quotesFor(list, "FOO")), "EUR");
  assert.ok(STABLECOINS.includes("USDC"));
});

test("Finnhub: its own Coinbase listing", () => {
  const list = parseFinnhubSymbols(fx("finnhub-coinbase-symbols.json"));
  assert.deepEqual([...list.keys()], ["1INCH", "ADA", "BTC", "ETH"]);
  assert.deepEqual(quotesFor(list, "ADA"), ["USDC"]);
});

test("splitPair and searchCoins", () => {
  assert.deepEqual(splitPair("SOL-EUR"), { base: "SOL", quote: "EUR" });
  const list = parseCoinbaseProducts(fx("coinbase-products.json"));
  assert.deepEqual(searchCoins(list, "s"), ["SHIB", "SOL"]);
  assert.deepEqual(searchCoins(list, "h"), ["ETH", "SHIB"]);
});

test("loadCoinList caches per source and key, shares in-flight loads, retries after a failure", async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => fx("coinbase-products.json") }; };
  await Promise.all([loadCoinList(ok, "coinbase", ""), loadCoinList(ok, "coinbase", "")]);
  await loadCoinList(ok, "coinbase", "");
  assert.equal(calls, 1);

  const fin = async () => { calls++; return { ok: true, json: async () => fx("finnhub-coinbase-symbols.json") }; };
  calls = 0;
  await loadCoinList(fin, "finnhub", "k-a");
  await loadCoinList(fin, "finnhub", "k-a");
  assert.equal(calls, 1);
  await loadCoinList(fin, "finnhub", "k-b");
  assert.equal(calls, 2);

  calls = 0;
  const bad = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(loadCoinList(bad, "finnhub", "k-retry"));
  assert.equal(calls, 1);
  const list = await loadCoinList(fin, "finnhub", "k-retry");
  assert.equal(calls, 2);
  assert.ok(list.has("BTC"));
});
