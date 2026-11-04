// Backwards compatibility with firmware 1.2.0 (spec §7). v120:: is the frozen
// 1.2.0 settings code; the unqualified names are the current library.
#include <unity.h>
#include <fstream>
#include <sstream>
#include <string>
#include <ArduinoJson.h>
#include "settings.h"
#include "v120_settings.h"

void setUp() {}
void tearDown() {}

static std::string readFixture(const char *name) {
  std::ifstream f(std::string("test/fixtures/") + name, std::ios::binary);
  TEST_ASSERT_TRUE_MESSAGE(f.good(), name);
  std::stringstream ss;
  ss << f.rdbuf();
  std::string s = ss.str();
  while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
  return s;
}

static std::string dumpNew(const Settings &s) {
  JsonDocument d;
  settingsToJson(s, d.to<JsonObject>());
  std::string out;
  serializeJson(d, out);
  return out;
}

static std::string dump120(const v120::Settings &s) {
  JsonDocument d;
  v120::settingsToJson(s, d.to<JsonObject>());
  std::string out;
  serializeJson(d, out);
  return out;
}

// K1 + K2: 1.3 loads a 1.2 file with nothing invalid and nothing reported as
// new in phase 1 (the ticker moves into stocks quietly), and writes it back as
// 1.2's text plus "v":2 and the stocks list.
static void test_k1_k2_a_1_2_0_file_loads_and_gains_stocks() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, readFixture("config-1.2.0.json")));
  Settings defaults{}, out{};
  strcpy(defaults.coins[0].pair, "BTC-USD");   // what the keys a 1.2 file lacks get
  defaults.coins[0].on = true;
  defaults.coinCount = 1;
  defaults.pages[7] = true;
  defaults.clockFormat = CLOCK_24H;
  defaults.night = {false, 23, 7, 8};
  AddedKeys added;
  JsonDocument inv;
  settingsLoad(defaults, doc.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(4, added.count);   // #24 adds clock_format and night on purpose
  TEST_ASSERT_TRUE(added.has("clock_format"));
  TEST_ASSERT_TRUE(added.has("night"));
  TEST_ASSERT_TRUE(added.has("coins"));
  TEST_ASSERT_TRUE(added.has("pages.coin"));
  TEST_ASSERT_EQUAL(0, inv.size());
  TEST_ASSERT_EQUAL_STRING(readFixture("config-1.3-from-1.2.json").c_str(), dumpNew(out).c_str());
}

// K3: 1.2 reads what 1.3 wrote back and gets its own settings.
static void test_k3_1_2_0_loads_what_1_3_writes() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, readFixture("config-1.3-from-1.2.json")));
  v120::Settings d120{}, o120{};
  v120::AddedKeys a120;
  JsonDocument i120;
  v120::settingsLoad(d120, doc.as<JsonVariantConst>(), o120, a120, i120.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, a120.count);
  TEST_ASSERT_EQUAL(0, i120.size());
  TEST_ASSERT_EQUAL_STRING(readFixture("config-1.2.0.json").c_str(), dump120(o120).c_str());
}

// C7: 1.2.0 loads a file written by a later firmware: the new keys are
// ignored, nothing is reported, every 1.2.0 value is kept.
static void test_c7_1_2_0_loads_a_future_file() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, readFixture("config-future.json")));
  v120::Settings d120{}, o120{};
  v120::AddedKeys a120;
  JsonDocument i120;
  v120::settingsLoad(d120, doc.as<JsonVariantConst>(), o120, a120, i120.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, a120.count);
  TEST_ASSERT_EQUAL(0, i120.size());
  TEST_ASSERT_EQUAL_STRING(readFixture("config-1.2.0.json").c_str(), dump120(o120).c_str());
}

static void test_current_code_loads_a_future_file() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, readFixture("config-future.json")));
  Settings defaults{}, out{};
  AddedKeys added;
  JsonDocument inv;
  settingsLoad(defaults, doc.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
  TEST_ASSERT_EQUAL(3, out.stockCount);
  TEST_ASSERT_EQUAL_STRING("AVGO", out.ticker);
  TEST_ASSERT_FALSE(out.stocks[2].on);
  TEST_ASSERT_EQUAL(2, out.coinCount);
  TEST_ASSERT_EQUAL(COIN_FINNHUB, out.coins[1].source);
  TEST_ASSERT_FALSE(out.coins[1].on);
  TEST_ASSERT_TRUE(out.pages[7]);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_k1_k2_a_1_2_0_file_loads_and_gains_stocks);
  RUN_TEST(test_c7_1_2_0_loads_a_future_file);
  RUN_TEST(test_k3_1_2_0_loads_what_1_3_writes);
  RUN_TEST(test_current_code_loads_a_future_file);
  return UNITY_END();
}
