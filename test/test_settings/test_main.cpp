#include <unity.h>
#include <string.h>
#include <string>
#include <ArduinoJson.h>
#include "settings.h"

void setUp() {}
void tearDown() {}

static Settings makeDefaults() {
  Settings s{};
  s.mountRight = false;
  s.theme = 2;
  strcpy(s.githubUser, "IdefixRC");
  strcpy(s.tzName, "Asia/Singapore");
  strcpy(s.tzRule, "<+08>-8");
  strcpy(s.ticker, "AAPL");
  strcpy(s.stockKey, "");
  strcpy(s.lat, "1.3119");
  strcpy(s.lon, "103.8149");
  s.tempFahrenheit = false;
  s.windMph = false;
  for (uint8_t i = 0; i < SETTINGS_PAGE_COUNT; i++) s.pages[i] = true;
  return s;
}

static std::string dump(const Settings &s) {
  JsonDocument d;
  settingsToJson(s, d.to<JsonObject>());
  std::string out;
  serializeJson(d, out);
  return out;
}

static bool hasAdded(const AddedKeys &a, const char *key) {
  for (uint8_t i = 0; i < a.count; i++)
    if (strcmp(a.keys[i], key) == 0) return true;
  return false;
}

// Defaults as a stored file, ready to be edited by a test.
static void defaultsAsFile(JsonDocument &file) {
  settingsToJson(makeDefaults(), file.to<JsonObject>());
}

// ── settingsToJson ────────────────────────────────────────

static void test_to_json_writes_every_key() {
  JsonDocument d;
  settingsToJson(makeDefaults(), d.to<JsonObject>());
  TEST_ASSERT_EQUAL(CONFIG_VERSION, d["v"].as<int>());
  TEST_ASSERT_EQUAL_STRING("left", d["mount"]);
  TEST_ASSERT_EQUAL(2, d["theme"].as<int>());
  TEST_ASSERT_EQUAL_STRING("IdefixRC", d["github_user"]);
  TEST_ASSERT_EQUAL_STRING("Asia/Singapore", d["tz_name"]);
  TEST_ASSERT_EQUAL_STRING("<+08>-8", d["tz_rule"]);
  TEST_ASSERT_EQUAL_STRING("AAPL", d["ticker"]);
  TEST_ASSERT_EQUAL_STRING("", d["stock_key"]);
  TEST_ASSERT_EQUAL_STRING("1.3119", d["lat"]);
  TEST_ASSERT_EQUAL_STRING("103.8149", d["lon"]);
  TEST_ASSERT_EQUAL_STRING("celsius", d["temp_unit"]);
  TEST_ASSERT_EQUAL_STRING("kmh", d["wind_unit"]);
  for (uint8_t i = 0; i < SETTINGS_PAGE_COUNT; i++)
    TEST_ASSERT_TRUE(d["pages"][SETTINGS_PAGE_KEYS[i]].as<bool>());
}

// ── settingsLoad ──────────────────────────────────────────

static void test_load_without_file_keeps_defaults_and_adds_nothing() {
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), JsonVariantConst(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING(dump(makeDefaults()).c_str(), dump(out).c_str());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
}

static void test_load_applies_every_key() {
  JsonDocument file;
  deserializeJson(file,
    "{\"v\":1,\"mount\":\"right\",\"theme\":4,\"github_user\":\"octo-cat\","
    "\"tz_name\":\"Europe/Berlin\",\"tz_rule\":\"CET-1CEST,M3.5.0,M10.5.0/3\","
    "\"ticker\":\"AVGO\",\"stock_key\":\"abc123\",\"lat\":\"48.1374\",\"lon\":\"11.5755\","
    "\"temp_unit\":\"fahrenheit\",\"wind_unit\":\"mph\","
    "\"pages\":{\"face\":true,\"clock\":false,\"date\":true,\"weather\":true,"
    "\"moon\":false,\"stock\":true,\"github\":true}}");
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_TRUE(out.mountRight);
  TEST_ASSERT_EQUAL(4, out.theme);
  TEST_ASSERT_EQUAL_STRING("octo-cat", out.githubUser);
  TEST_ASSERT_EQUAL_STRING("Europe/Berlin", out.tzName);
  TEST_ASSERT_EQUAL_STRING("CET-1CEST,M3.5.0,M10.5.0/3", out.tzRule);
  TEST_ASSERT_EQUAL_STRING("AVGO", out.ticker);
  TEST_ASSERT_EQUAL_STRING("abc123", out.stockKey);
  TEST_ASSERT_EQUAL_STRING("48.1374", out.lat);
  TEST_ASSERT_EQUAL_STRING("11.5755", out.lon);
  TEST_ASSERT_TRUE(out.tempFahrenheit);
  TEST_ASSERT_TRUE(out.windMph);
  TEST_ASSERT_FALSE(out.pages[1]);
  TEST_ASSERT_FALSE(out.pages[4]);
  TEST_ASSERT_TRUE(out.pages[5]);
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
}

static void test_load_missing_key_keeps_default_and_reports_it() {
  JsonDocument file;
  defaultsAsFile(file);
  file.remove("ticker");
  file["theme"] = 4;
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(4, out.theme);
  TEST_ASSERT_EQUAL_STRING("AAPL", out.ticker);
  TEST_ASSERT_EQUAL(1, added.count);
  TEST_ASSERT_TRUE(hasAdded(added, "ticker"));
}

static void test_load_missing_page_is_reported() {
  JsonDocument file;
  defaultsAsFile(file);
  file["pages"].remove("github");
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_TRUE(out.pages[6]);
  TEST_ASSERT_TRUE(hasAdded(added, "pages.github"));
}

static void test_load_invalid_value_keeps_default() {
  JsonDocument file;
  defaultsAsFile(file);
  file["theme"] = 9;
  file["lat"] = "north";
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(2, out.theme);
  TEST_ASSERT_EQUAL_STRING("1.3119", out.lat);
  TEST_ASSERT_FALSE(inv["theme"].isNull());
  TEST_ASSERT_FALSE(inv["lat"].isNull());
  TEST_ASSERT_EQUAL(0, added.count);
}

static void test_load_ignores_unknown_keys() {
  JsonDocument file;
  defaultsAsFile(file);
  file["future_key"] = 1;
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING(dump(makeDefaults()).c_str(), dump(out).c_str());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
}

// ── settingsMerge ─────────────────────────────────────────

static void test_merge_partial_changes_only_that_key() {
  JsonDocument patch;
  deserializeJson(patch, "{\"ticker\":\"AVGO\"}");
  Settings out; JsonDocument errs;
  TEST_ASSERT_TRUE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  Settings expected = makeDefaults();
  strcpy(expected.ticker, "AVGO");
  TEST_ASSERT_EQUAL_STRING(dump(expected).c_str(), dump(out).c_str());
}

static void test_merge_partial_pages() {
  JsonDocument patch;
  deserializeJson(patch, "{\"pages\":{\"stock\":false}}");
  Settings out; JsonDocument errs;
  TEST_ASSERT_TRUE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  TEST_ASSERT_FALSE(out.pages[5]);
  TEST_ASSERT_TRUE(out.pages[0]);
  TEST_ASSERT_TRUE(out.pages[6]);
}

static void test_merge_rejects_bad_values_with_errors() {
  JsonDocument patch;
  deserializeJson(patch,
    "{\"theme\":9,\"lat\":\"95\",\"mount\":\"up\",\"ticker\":\"aapl\","
    "\"temp_unit\":\"kelvin\",\"pages\":{\"clock\":\"yes\"}}");
  Settings out; JsonDocument errs;
  TEST_ASSERT_FALSE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  TEST_ASSERT_FALSE(errs["theme"].isNull());
  TEST_ASSERT_FALSE(errs["lat"].isNull());
  TEST_ASSERT_FALSE(errs["mount"].isNull());
  TEST_ASSERT_FALSE(errs["ticker"].isNull());
  TEST_ASSERT_FALSE(errs["temp_unit"].isNull());
  TEST_ASSERT_FALSE(errs["pages.clock"].isNull());
}

static void test_merge_rejects_non_object() {
  JsonDocument patch;
  deserializeJson(patch, "[1]");
  Settings out; JsonDocument errs;
  TEST_ASSERT_FALSE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  TEST_ASSERT_FALSE(errs["config"].isNull());
}

static void test_merge_accepts_empty_github_user_and_ignores_unknown() {
  JsonDocument patch;
  deserializeJson(patch, "{\"github_user\":\"\",\"v\":1,\"future_key\":true}");
  Settings out; JsonDocument errs;
  TEST_ASSERT_TRUE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  TEST_ASSERT_EQUAL_STRING("", out.githubUser);
  TEST_ASSERT_EQUAL(0, errs.size());
}

static void test_merge_rejects_url_breaking_characters() {
  JsonDocument patch;
  deserializeJson(patch, "{\"stock_key\":\"abc&symbol=X\",\"github_user\":\"a/b\"}");
  Settings out; JsonDocument errs;
  TEST_ASSERT_FALSE(settingsMerge(makeDefaults(), patch.as<JsonVariantConst>(), out, errs.to<JsonObject>()));
  TEST_ASSERT_FALSE(errs["stock_key"].isNull());
  TEST_ASSERT_FALSE(errs["github_user"].isNull());
}

// ── Round trip ────────────────────────────────────────────

static void test_round_trip_through_json() {
  Settings s = makeDefaults();
  s.mountRight = true; s.theme = 0; s.windMph = true; s.pages[3] = false;
  strcpy(s.tzRule, "EST5EDT,M3.2.0,M11.1.0");
  JsonDocument file;
  deserializeJson(file, dump(s));
  Settings out; AddedKeys added; JsonDocument inv;
  settingsLoad(makeDefaults(), file.as<JsonVariantConst>(), out, added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING(dump(s).c_str(), dump(out).c_str());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
}

// ── wifiValidate ──────────────────────────────────────────

static bool runWifi(const char *json, char *ssid, char *pass, JsonDocument &errs) {
  JsonDocument w;
  deserializeJson(w, json);
  return wifiValidate(w.as<JsonVariantConst>(), ssid, 33, pass, 64, errs.to<JsonObject>());
}

static void test_wifi_valid() {
  char ssid[33], pass[64]; JsonDocument errs;
  TEST_ASSERT_TRUE(runWifi("{\"ssid\":\"Home\",\"password\":\"secret123\"}", ssid, pass, errs));
  TEST_ASSERT_EQUAL_STRING("Home", ssid);
  TEST_ASSERT_EQUAL_STRING("secret123", pass);
}

static void test_wifi_open_network() {
  char ssid[33], pass[64]; JsonDocument errs;
  TEST_ASSERT_TRUE(runWifi("{\"ssid\":\"Cafe\",\"password\":\"\"}", ssid, pass, errs));
  TEST_ASSERT_EQUAL_STRING("", pass);
  TEST_ASSERT_TRUE(runWifi("{\"ssid\":\"Cafe\"}", ssid, pass, errs));
  TEST_ASSERT_EQUAL_STRING("", pass);
}

static void test_wifi_rejects_bad_input() {
  char ssid[33], pass[64]; JsonDocument errs;
  TEST_ASSERT_FALSE(runWifi("{\"ssid\":\"\",\"password\":\"secret123\"}", ssid, pass, errs));
  TEST_ASSERT_FALSE(errs["wifi.ssid"].isNull());
  TEST_ASSERT_FALSE(runWifi("{\"ssid\":\"Home\",\"password\":\"short77\"}", ssid, pass, errs));
  TEST_ASSERT_FALSE(errs["wifi.password"].isNull());
  TEST_ASSERT_FALSE(runWifi("{\"ssid\":\"123456789012345678901234567890123\"}", ssid, pass, errs));
  TEST_ASSERT_FALSE(errs["wifi.ssid"].isNull());
  TEST_ASSERT_FALSE(runWifi("\"Home\"", ssid, pass, errs));
  TEST_ASSERT_FALSE(errs["wifi"].isNull());
}

// ── tzRuleFromOffset ──────────────────────────────────────

static void test_tz_rule_whole_hours_east() {
  char r[24];
  TEST_ASSERT_TRUE(tzRuleFromOffset(8, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("<+08>-8", r);
}

static void test_tz_rule_whole_hours_west() {
  char r[24];
  TEST_ASSERT_TRUE(tzRuleFromOffset(-5, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("<-05>5", r);
}

static void test_tz_rule_half_and_quarter_hours() {
  char r[24];
  TEST_ASSERT_TRUE(tzRuleFromOffset(5.5f, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("<+0530>-5:30", r);
  TEST_ASSERT_TRUE(tzRuleFromOffset(5.75f, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("<+0545>-5:45", r);
  TEST_ASSERT_TRUE(tzRuleFromOffset(-3.5f, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("<-0330>3:30", r);
}

static void test_tz_rule_utc() {
  char r[24];
  TEST_ASSERT_TRUE(tzRuleFromOffset(0, r, sizeof r));
  TEST_ASSERT_EQUAL_STRING("UTC0", r);
}

static void test_tz_rule_rejects_out_of_range_and_small_buffer() {
  char r[24];
  TEST_ASSERT_FALSE(tzRuleFromOffset(15, r, sizeof r));
  TEST_ASSERT_FALSE(tzRuleFromOffset(-13, r, sizeof r));
  char tiny[4];
  TEST_ASSERT_FALSE(tzRuleFromOffset(8, tiny, sizeof tiny));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_tz_rule_whole_hours_east);
  RUN_TEST(test_tz_rule_whole_hours_west);
  RUN_TEST(test_tz_rule_half_and_quarter_hours);
  RUN_TEST(test_tz_rule_utc);
  RUN_TEST(test_tz_rule_rejects_out_of_range_and_small_buffer);
  RUN_TEST(test_to_json_writes_every_key);
  RUN_TEST(test_load_without_file_keeps_defaults_and_adds_nothing);
  RUN_TEST(test_load_applies_every_key);
  RUN_TEST(test_load_missing_key_keeps_default_and_reports_it);
  RUN_TEST(test_load_missing_page_is_reported);
  RUN_TEST(test_load_invalid_value_keeps_default);
  RUN_TEST(test_load_ignores_unknown_keys);
  RUN_TEST(test_merge_partial_changes_only_that_key);
  RUN_TEST(test_merge_partial_pages);
  RUN_TEST(test_merge_rejects_bad_values_with_errors);
  RUN_TEST(test_merge_rejects_non_object);
  RUN_TEST(test_merge_accepts_empty_github_user_and_ignores_unknown);
  RUN_TEST(test_merge_rejects_url_breaking_characters);
  RUN_TEST(test_round_trip_through_json);
  RUN_TEST(test_wifi_valid);
  RUN_TEST(test_wifi_open_network);
  RUN_TEST(test_wifi_rejects_bad_input);
  return UNITY_END();
}
