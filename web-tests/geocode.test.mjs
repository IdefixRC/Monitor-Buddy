import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCity } from "../web/js/geocode.js";

const MUNICH = { name: "Munich", admin1: "Bavaria", country: "Germany", latitude: 48.13743,
  longitude: 11.57549, timezone: "Europe/Berlin" };

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
const ok = (body) => fake({ status: 200, body });

test("a Munich result maps to label, strings with 4 decimals and tz", async () => {
  assert.deepEqual(await searchCity(ok({ results: [MUNICH] }), "Munich"), [{
    label: "Munich, Bavaria, Germany", name: "Munich", region: "Bavaria", country: "Germany",
    lat: "48.1374", lon: "11.5755", tz: "Europe/Berlin" }]);
});
test("a missing results gives an empty list", async () => {
  assert.deepEqual(await searchCity(ok({ generationtime_ms: 0.5 }), "Zzzzzz"), []);
});
test("an empty results gives an empty list", async () => {
  assert.deepEqual(await searchCity(ok({ results: [] }), "Zzzzzz"), []);
});
test("the label leaves out empty parts", async () => {
  const r = await searchCity(ok({ results: [{ name: "Singapore", country: "Singapore", latitude: 1.28967,
    longitude: 103.85007, timezone: "Asia/Singapore" }] }), "Singapore");
  assert.equal(r[0].label, "Singapore, Singapore");
  assert.equal(r[0].region, "");
});
test("the label leaves out a missing country too", async () => {
  const r = await searchCity(ok({ results: [{ name: "Nowhere", admin1: "Region", latitude: 1, longitude: 2,
    timezone: "UTC" }] }), "Nowhere");
  assert.equal(r[0].label, "Nowhere, Region");
  assert.equal(r[0].country, "");
});
test("a negative zero becomes 0.0000", async () => {
  const r = await searchCity(ok({ results: [{ name: "Null Island", country: "Ocean", latitude: -0.00001,
    longitude: -0, timezone: "UTC" }] }), "Null Island");
  assert.equal(r[0].lat, "0.0000");
  assert.equal(r[0].lon, "0.0000");
});
test("small negative numbers keep their sign", async () => {
  const r = await searchCity(ok({ results: [{ name: "Quito", country: "Ecuador", latitude: -0.1807,
    longitude: -78.4678, timezone: "America/Guayaquil" }] }), "Quito");
  assert.equal(r[0].lat, "-0.1807");
  assert.equal(r[0].lon, "-78.4678");
});
test("whole numbers get 4 decimals", async () => {
  const r = await searchCity(ok({ results: [{ name: "X", country: "Y", latitude: 48, longitude: 11,
    timezone: "UTC" }] }), "X");
  assert.equal(r[0].lat, "48.0000");
  assert.equal(r[0].lon, "11.0000");
});
test("results keep the service's order", async () => {
  const r = await searchCity(ok({ results: [MUNICH, { ...MUNICH, name: "Munich", admin1: "Texas", country: "United States" }] }), "Munich");
  assert.deepEqual(r.map((x) => x.region), ["Bavaria", "Texas"]);
});
test("the URL is exact and encoded", async () => {
  const f = ok({});
  await searchCity(f, "São Paulo & co");
  assert.deepEqual(f.urls, ["https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o%20Paulo%20%26%20co&count=8&language=en&format=json"]);
});
test("a blank name gives an empty list without asking", async () => {
  const f = ok({ results: [MUNICH] });
  assert.deepEqual(await searchCity(f, "   "), []);
  assert.deepEqual(f.urls, []);
});
test("a network error throws", async () => {
  await assert.rejects(searchCity(fake(new TypeError("Failed to fetch")), "Munich"), TypeError);
});
test("an HTTP error throws", async () => {
  await assert.rejects(searchCity(fake({ status: 500, body: {} }), "Munich"), /500/);
});
