// City search for the weather location, on Open-Meteo's geocoding API.
// `fetchFn` is injected. A network or HTTP error throws; no match is [].

const SEARCH = "https://geocoding-api.open-meteo.com/v1/search";

// 4 decimals, as the firmware stores them (lat/lon are text). Never "-0.0000".
function coord(n) {
  const s = Number(n).toFixed(4);
  return s === "-0.0000" ? "0.0000" : s;
}

// -> [{ label, name, region, country, lat, lon, tz }], in the service's order.
export async function searchCity(fetchFn, name) {
  if (name.trim() === "") return [];
  const res = await fetchFn(
    `${SEARCH}?name=${encodeURIComponent(name)}&count=8&language=en&format=json`);
  if (!res.ok) throw new Error(`City search failed (HTTP ${res.status})`);
  const body = await res.json();
  return (body.results ?? []).map((r) => {
    const region = r.admin1 ?? "", country = r.country ?? "";
    return {
      label: [r.name, region, country].filter((p) => p).join(", "),
      name: r.name,
      region,
      country,
      lat: coord(r.latitude),
      lon: coord(r.longitude),
      tz: r.timezone,
    };
  });
}
