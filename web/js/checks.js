// Live checks of the settings the Buddy will use: the Finnhub key and ticker,
// and the GitHub user. `fetchFn` is injected (window.fetch in the browser, a
// fake in the tests). Every outcome is a status, never a throw.

const FINNHUB = "https://finnhub.io/api/v1/quote";
const GITHUB = "https://api.github.com/users/";

async function bodyOf(res) {
  try { return await res.json(); } catch { return null; }
}

// -> { status: "ok", price } | { status: "key_rejected" | "ticker_not_found" |
//      "rate_limited" | "network" }
export async function checkStock(fetchFn, ticker, key) {
  let res;
  try {
    res = await fetchFn(`${FINNHUB}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`);
  } catch {
    return { status: "network" };
  }
  if (res.status === 401) return { status: "key_rejected" };
  // 403: Finnhub's answer for a symbol the free plan doesn't cover (non-US).
  if (res.status === 403) return { status: "ticker_not_found" };
  if (res.status === 429) return { status: "rate_limited" };
  if (!res.ok) return { status: "network" };
  const body = await bodyOf(res);
  if (body === null) return { status: "network" };
  // Finnhub answers 200 with c = 0 for a symbol it doesn't know.
  if (typeof body.c !== "number" || !(body.c > 0)) return { status: "ticker_not_found" };
  return { status: "ok", price: body.c };
}

// -> { status: "ok", followers, repos } | { status: "not_found" | "rate_limited" | "network" }
export async function checkGithub(fetchFn, user) {
  let res;
  try {
    res = await fetchFn(`${GITHUB}${encodeURIComponent(user)}`);
  } catch {
    return { status: "network" };
  }
  if (res.status === 404) return { status: "not_found" };
  // GitHub's unauthenticated limit answers 403 (or 429).
  if (res.status === 403 || res.status === 429) return { status: "rate_limited" };
  if (!res.ok) return { status: "network" };
  const body = await bodyOf(res);
  if (body === null) return { status: "network" };
  return { status: "ok", followers: body.followers, repos: body.public_repos };
}
