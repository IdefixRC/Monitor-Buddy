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

test("loadCoinList caches per source and key, and throws on a failed fetch", async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => fx("coinbase-products.json") }; };
  await loadCoinList(ok, "coinbase", "");
  await loadCoinList(ok, "coinbase", "");
  assert.equal(calls, 1);
  await assert.rejects(loadCoinList(async () => ({ ok: false, status: 500 }), "finnhub", "k1"));
});
