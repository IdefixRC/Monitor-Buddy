// Coin lists for the flasher's coin picker (spec stocks-and-coins §6.2, D16):
// each source's own list, so only pairs that exist on that source are offered.
const COINBASE_PRODUCTS = "https://api.exchange.coinbase.com/products";
const FINNHUB_SYMBOLS = "https://finnhub.io/api/v1/crypto/symbol?exchange=coinbase&token=";

export const STABLECOINS = Object.freeze(["USDC", "USDT", "EURC", "XSGD", "AUDD", "TGBP", "PYUSD", "DAI", "GUSD", "PAX", "BUSD", "USDS"]);

function build(pairs) {
  const map = new Map();
  for (const [base, quote] of pairs) {
    if (STABLECOINS.includes(base)) continue;
    if (!map.has(base)) map.set(base, new Set());
    map.get(base).add(quote);
  }
  const order = (q) => (q === "USD" ? "" : q);   // USD first, then A-Z
  return new Map([...map.keys()].sort().map((b) => [b, [...map.get(b)].sort((x, y) => order(x).localeCompare(order(y)))]));
}

export const splitPair = (pair) => { const [base, quote] = String(pair).split("-"); return { base, quote }; };

// The key of a checked coin price in app.live.coinPrices: the same pair can
// cost a little differently on Coinbase and on Finnhub.
export const coinPriceKey = (source, pair) => `${source}:${pair}`;

export function parseCoinbaseProducts(json) {
  return build((Array.isArray(json) ? json : [])
    .filter((p) => p && p.status === "online" && p.base_currency && p.quote_currency)
    .map((p) => [p.base_currency, p.quote_currency]));
}

export function parseFinnhubSymbols(json) {
  return build((Array.isArray(json) ? json : [])
    .map((s) => String((s && s.displaySymbol) || "").replace("/", "-"))
    .filter((d) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(d))
    .map((d) => d.split("-")));
}

export const quotesFor = (list, base) => list.get(base) || [];
export const defaultQuote = (quotes) => (quotes.includes("USD") ? "USD" : quotes[0] || "");

export function searchCoins(list, text) {
  const t = String(text || "").trim().toUpperCase();
  const bases = [...list.keys()];
  if (!t) return bases.slice(0, 30);
  const starts = bases.filter((b) => b.startsWith(t));
  const contains = bases.filter((b) => !b.startsWith(t) && b.includes(t));
  return [...starts, ...contains].slice(0, 30);
}

// Caches the in-flight promise, so two pickers opening at once fetch once;
// a failed load is dropped from the cache so it is retried.
const cache = new Map();
export function loadCoinList(fetchFn, source, key) {
  const id = `${source}|${source === "finnhub" ? key : ""}`;
  if (cache.has(id)) return cache.get(id);
  const url = source === "finnhub" ? FINNHUB_SYMBOLS + encodeURIComponent(key) : COINBASE_PRODUCTS;
  const promise = (async () => {
    const res = await fetchFn(url);
    if (!res || !res.ok) throw new Error(`coin list ${source}: ${res ? res.status : "no reply"}`);
    return source === "finnhub" ? parseFinnhubSymbols(await res.json()) : parseCoinbaseProducts(await res.json());
  })();
  cache.set(id, promise);
  promise.catch(() => { if (cache.get(id) === promise) cache.delete(id); });
  return promise;
}
