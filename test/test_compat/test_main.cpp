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

// C1 + C2: the current code loads a 1.2.0 file with nothing added or invalid,
// and writes it back byte for byte, exactly as 1.2.0's code does.
static void test_c1_c2_a_1_2_0_file_loads_and_writes_back_unchanged() {
  const std::string file = readFixture("config-1.2.0.json");
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, file));

  Settings defaults{}, out{};
  AddedKeys added;
  JsonDocument inv;
  settingsLoad(defaults, doc.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
  TEST_ASSERT_EQUAL_STRING(file.c_str(), dumpNew(out).c_str());

  v120::Settings d120{}, o120{};
  v120::AddedKeys a120;
  JsonDocument i120;
  v120::settingsLoad(d120, doc.as<JsonVariantConst>(), o120, a120, i120.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING(dump120(o120).c_str(), dumpNew(out).c_str());
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

// The current firmware does the same with the future file (it has none of
// the future keys yet).
static void test_current_code_ignores_future_keys() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, readFixture("config-future.json")));
  Settings defaults{}, out{};
  AddedKeys added;
  JsonDocument inv;
  settingsLoad(defaults, doc.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
  TEST_ASSERT_EQUAL_STRING(readFixture("config-1.2.0.json").c_str(), dumpNew(out).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_c1_c2_a_1_2_0_file_loads_and_writes_back_unchanged);
  RUN_TEST(test_c7_1_2_0_loads_a_future_file);
  RUN_TEST(test_current_code_ignores_future_keys);
  return UNITY_END();
}
