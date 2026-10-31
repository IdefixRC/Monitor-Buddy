// The generic settings engine on a demo struct that has every kind: an int, a
// group without and a group with a check, a list of values, a list of records.
#include <unity.h>
#include <stddef.h>
#include <string.h>
#include <string>
#include <ArduinoJson.h>
#include "schema.h"

using namespace schema;

void setUp() {}
void tearDown() {}

struct Coin  { char pair[22]; uint8_t style; };
struct Night { bool enabled; uint8_t start, end, brightness; };
struct Demo {
  uint8_t theme;
  bool    flags[2];
  Night   night;
  char    names[5][11];
  uint8_t nameCount;
  Coin    coins[5];
  uint8_t coinCount;
};

static bool nightCheck(const uint8_t *g) {
  const Night *n = reinterpret_cast<const Night *>(g);
  return n->start != n->end;
}
static bool pairCheck(const uint8_t *v) {
  const char *s = reinterpret_cast<const char *>(v);
  const char *dash = strchr(s, '-');
  size_t n = strlen(s);
  return dash && dash != s && dash != s + n - 1 && strchr(dash + 1, '-') == nullptr;
}

static const char *const STYLE_WORDS[] = {"finnhub", "coinbase"};
static const Coin COIN_DEFAULT = {"BTC-USD", 1};

static const Field FLAG_FIELDS[] = {
  boolField("a", 0, "must be true or false"),
  boolField("b", 1, "must be true or false"),
};
static const Field NIGHT_FIELDS[] = {
  boolField("enabled", offsetof(Night, enabled), "must be true or false"),
  intField("start", offsetof(Night, start), 1, 0, 23, "a whole hour 0-23"),
  intField("end", offsetof(Night, end), 1, 0, 23, "a whole hour 0-23"),
  intField("brightness", offsetof(Night, brightness), 1, 8, 255, "a whole number 8-255"),
};
static const Field NAME_FIELD[] = {
  textField(nullptr, 0, 11, 1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-", "1-10 characters: A-Z, 0-9, . and -"),
};
static const Field COIN_FIELDS[] = {
  textField("pair", offsetof(Coin, pair), 22, 3, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
            "3-21 characters: A-Z, 0-9 and one -", pairCheck),
  choiceField("style", offsetof(Coin, style), STYLE_WORDS, 2, "must be \"finnhub\" or \"coinbase\""),
};
static const Field DEMO[] = {
  intField("theme", offsetof(Demo, theme), 1, 0, 4, "must be a whole number 0-4"),
  groupField("flags", offsetof(Demo, flags), sizeof(Demo::flags), FLAG_FIELDS, 2),
  groupField("night", offsetof(Demo, night), sizeof(Night), NIGHT_FIELDS, 4,
             "start and end must differ", nightCheck),
  listField("names", offsetof(Demo, names), offsetof(Demo, nameCount), sizeof(Demo::names[0]), 1, 5,
            NAME_FIELD, 1, "1-5 entries"),
  listField("coins", offsetof(Demo, coins), offsetof(Demo, coinCount), sizeof(Coin), 1, 5,
            COIN_FIELDS, 2, "1-5 entries", &COIN_DEFAULT),
};
static const uint8_t DEMO_N = sizeof(DEMO) / sizeof(DEMO[0]);

static Demo demoDefaults() {
  Demo d{};
  d.theme = 2;
  d.flags[0] = true;
  d.night = {false, 23, 7, 8};
  strcpy(d.names[0], "AAPL");
  d.nameCount = 1;
  d.coins[0] = COIN_DEFAULT;
  d.coinCount = 1;
  return d;
}

static std::string dump(const Demo &d) {
  JsonDocument doc;
  toJson(DEMO, DEMO_N, &d, doc.to<JsonObject>());
  std::string s;
  serializeJson(doc, s);
  return s;
}

static bool mergeText(const Demo &cur, const char *patch, Demo &out, JsonDocument &errs) {
  JsonDocument p;
  deserializeJson(p, patch);
  return merge(DEMO, DEMO_N, &cur, p.as<JsonVariantConst>(), &out, sizeof(Demo), errs.to<JsonObject>());
}

static void loadText(const char *file, Demo &out, Paths &added, JsonDocument &inv) {
  JsonDocument f;
  deserializeJson(f, file);
  Demo d = demoDefaults();
  load(DEMO, DEMO_N, &d, f.as<JsonVariantConst>(), &out, sizeof(Demo), added, inv.to<JsonObject>());
}

static const char *DEFAULT_JSON =
  "{\"theme\":2,\"flags\":{\"a\":true,\"b\":false},"
  "\"night\":{\"enabled\":false,\"start\":23,\"end\":7,\"brightness\":8},"
  "\"names\":[\"AAPL\"],\"coins\":[{\"pair\":\"BTC-USD\",\"style\":\"coinbase\"}]}";

// ── toJson ────────────────────────────────────────────────

static void test_to_json_writes_every_kind_in_table_order() {
  TEST_ASSERT_EQUAL_STRING(DEFAULT_JSON, dump(demoDefaults()).c_str());
}

// ── merge ─────────────────────────────────────────────────

static void test_merge_group_changes_only_the_given_field() {
  Demo out; JsonDocument e;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"flags\":{\"b\":true}}", out, e));
  TEST_ASSERT_TRUE(out.flags[0]);
  TEST_ASSERT_TRUE(out.flags[1]);
}

static void test_merge_group_null_field_is_unchanged() {
  Demo out; JsonDocument e;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"flags\":{\"a\":null}}", out, e));
  TEST_ASSERT_TRUE(out.flags[0]);
}

static void test_merge_group_not_an_object() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"flags\":true}", out, e));
  TEST_ASSERT_EQUAL_STRING("must be an object", e["flags"]);
}

static void test_merge_group_check_uses_the_merged_group() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"night\":{\"start\":7}}", out, e));  // end is 7
  TEST_ASSERT_EQUAL_STRING("start and end must differ", e["night"]);
  JsonDocument e2;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"night\":{\"start\":22}}", out, e2));
  TEST_ASSERT_EQUAL(22, out.night.start);
}

static void test_merge_group_field_error_skips_the_check() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"night\":{\"start\":24,\"end\":24}}", out, e));
  TEST_ASSERT_EQUAL_STRING("a whole hour 0-23", e["night.start"]);
  TEST_ASSERT_EQUAL_STRING("a whole hour 0-23", e["night.end"]);
  TEST_ASSERT_TRUE(e["night"].isNull());
}

static void test_merge_value_list_replaces_whole() {
  Demo out; JsonDocument e;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"names\":[\"MSFT\",\"BRK.B\"]}", out, e));
  TEST_ASSERT_EQUAL(2, out.nameCount);
  TEST_ASSERT_EQUAL_STRING("MSFT", out.names[0]);
  TEST_ASSERT_EQUAL_STRING("BRK.B", out.names[1]);
}

static void test_merge_list_count_limits() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"names\":[]}", out, e));
  TEST_ASSERT_EQUAL_STRING("1-5 entries", e["names"]);
  JsonDocument e2;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"names\":[\"A\",\"B\",\"C\",\"D\",\"E\",\"F\"]}", out, e2));
  TEST_ASSERT_EQUAL_STRING("1-5 entries", e2["names"]);
  JsonDocument e3;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"names\":\"AAPL\"}", out, e3));
  TEST_ASSERT_EQUAL_STRING("1-5 entries", e3["names"]);
}

static void test_merge_value_list_bad_entry_is_named() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"names\":[\"AAPL\",\"aapl\"]}", out, e));
  TEST_ASSERT_EQUAL_STRING("1-10 characters: A-Z, 0-9, . and -", e["names[1]"]);
  TEST_ASSERT_EQUAL(1, e.size());
}

static void test_merge_record_missing_field_takes_the_entry_default() {
  Demo out; JsonDocument e;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"coins\":[{\"pair\":\"SOL-EUR\"},{\"pair\":\"ETH-USD\",\"style\":\"finnhub\"}]}", out, e));
  TEST_ASSERT_EQUAL(2, out.coinCount);
  TEST_ASSERT_EQUAL_STRING("SOL-EUR", out.coins[0].pair);
  TEST_ASSERT_EQUAL(1, out.coins[0].style);
  TEST_ASSERT_EQUAL(0, out.coins[1].style);
}

static void test_merge_record_errors_are_named() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"coins\":[{\"pair\":\"BTCUSD\"},7,{\"pair\":\"A-B\",\"style\":\"x\"}]}", out, e));
  TEST_ASSERT_EQUAL_STRING("3-21 characters: A-Z, 0-9 and one -", e["coins[0].pair"]);
  TEST_ASSERT_EQUAL_STRING("must be an object", e["coins[1]"]);
  TEST_ASSERT_EQUAL_STRING("must be \"finnhub\" or \"coinbase\"", e["coins[2].style"]);
  TEST_ASSERT_EQUAL(3, e.size());
}

static void test_merge_skips_unknown_keys_and_v() {
  Demo out; JsonDocument e;
  TEST_ASSERT_TRUE(mergeText(demoDefaults(), "{\"v\":9,\"later\":1,\"theme\":3}", out, e));
  TEST_ASSERT_EQUAL(3, out.theme);
}

static void test_merge_explicit_null_top_level_is_an_error() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "{\"theme\":null}", out, e));
  TEST_ASSERT_EQUAL_STRING("must be a whole number 0-4", e["theme"]);
}

static void test_merge_rejects_non_object() {
  Demo out; JsonDocument e;
  TEST_ASSERT_FALSE(mergeText(demoDefaults(), "[1]", out, e));
  TEST_ASSERT_EQUAL_STRING("must be an object", e["config"]);
}

// ── load ──────────────────────────────────────────────────

static void test_load_round_trip_reports_nothing() {
  Demo out; Paths added; JsonDocument inv;
  loadText(DEFAULT_JSON, out, added, inv);
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL(0, inv.size());
  TEST_ASSERT_EQUAL_STRING(DEFAULT_JSON, dump(out).c_str());
}

static void test_load_reports_missing_keys_group_fields_and_record_fields() {
  Demo out; Paths added; JsonDocument inv;
  loadText("{\"flags\":{\"a\":false},\"coins\":[{\"pair\":\"SOL-EUR\"}]}", out, added, inv);
  TEST_ASSERT_TRUE(added.has("theme"));
  TEST_ASSERT_TRUE(added.has("flags.b"));
  TEST_ASSERT_TRUE(added.has("night"));
  TEST_ASSERT_TRUE(added.has("names"));
  TEST_ASSERT_TRUE(added.has("coins.style"));
  TEST_ASSERT_EQUAL(5, added.count);
  TEST_ASSERT_FALSE(out.flags[0]);
  TEST_ASSERT_EQUAL_STRING("SOL-EUR", out.coins[0].pair);
  TEST_ASSERT_EQUAL(1, out.coins[0].style);
}

static void test_load_list_with_a_bad_entry_falls_back_whole() {
  Demo out; Paths added; JsonDocument inv;
  loadText("{\"names\":[\"MSFT\",\"bad!\"],\"coins\":[{\"pair\":\"SOL-EUR\"},{\"pair\":\"X\"}]}", out, added, inv);
  TEST_ASSERT_EQUAL(1, out.nameCount);
  TEST_ASSERT_EQUAL_STRING("AAPL", out.names[0]);
  TEST_ASSERT_EQUAL(1, out.coinCount);
  TEST_ASSERT_EQUAL_STRING("BTC-USD", out.coins[0].pair);
  TEST_ASSERT_EQUAL_STRING("1-10 characters: A-Z, 0-9, . and -", inv["names[1]"]);
  TEST_ASSERT_EQUAL_STRING("3-21 characters: A-Z, 0-9 and one -", inv["coins[1].pair"]);
  TEST_ASSERT_FALSE(added.has("coins.style"));   // only reported for a list that loaded
}

static void test_load_group_check_failure_restores_the_group() {
  Demo out; Paths added; JsonDocument inv;
  loadText("{\"night\":{\"enabled\":true,\"start\":5,\"end\":5,\"brightness\":40}}", out, added, inv);
  TEST_ASSERT_FALSE(out.night.enabled);
  TEST_ASSERT_EQUAL(23, out.night.start);
  TEST_ASSERT_EQUAL(8, out.night.brightness);   // the whole group returns to its default
  TEST_ASSERT_EQUAL_STRING("start and end must differ", inv["night"]);
}

static void test_load_group_not_an_object_and_bad_field() {
  Demo out; Paths added; JsonDocument inv;
  loadText("{\"flags\":3,\"night\":{\"start\":99}}", out, added, inv);
  TEST_ASSERT_EQUAL_STRING("must be an object", inv["flags"]);
  TEST_ASSERT_EQUAL_STRING("a whole hour 0-23", inv["night.start"]);
}

static void test_load_null_and_non_object_file_add_nothing() {
  Demo out; Paths added; JsonDocument inv;
  Demo d = demoDefaults();
  load(DEMO, DEMO_N, &d, JsonVariantConst(), &out, sizeof(Demo), added, inv.to<JsonObject>());
  TEST_ASSERT_EQUAL(0, added.count);
  TEST_ASSERT_EQUAL_STRING(DEFAULT_JSON, dump(out).c_str());
}

static void test_paths_ignore_duplicates_and_overflow() {
  Paths p;
  p.add("a"); p.add("a");
  TEST_ASSERT_EQUAL(1, p.count);
  char k[8];
  for (int i = 0; i < 40; i++) { snprintf(k, sizeof k, "k%d", i); p.add(k); }
  TEST_ASSERT_EQUAL(Paths::MAX, p.count);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_to_json_writes_every_kind_in_table_order);
  RUN_TEST(test_merge_group_changes_only_the_given_field);
  RUN_TEST(test_merge_group_null_field_is_unchanged);
  RUN_TEST(test_merge_group_not_an_object);
  RUN_TEST(test_merge_group_check_uses_the_merged_group);
  RUN_TEST(test_merge_group_field_error_skips_the_check);
  RUN_TEST(test_merge_value_list_replaces_whole);
  RUN_TEST(test_merge_list_count_limits);
  RUN_TEST(test_merge_value_list_bad_entry_is_named);
  RUN_TEST(test_merge_record_missing_field_takes_the_entry_default);
  RUN_TEST(test_merge_record_errors_are_named);
  RUN_TEST(test_merge_skips_unknown_keys_and_v);
  RUN_TEST(test_merge_explicit_null_top_level_is_an_error);
  RUN_TEST(test_merge_rejects_non_object);
  RUN_TEST(test_load_round_trip_reports_nothing);
  RUN_TEST(test_load_reports_missing_keys_group_fields_and_record_fields);
  RUN_TEST(test_load_list_with_a_bad_entry_falls_back_whole);
  RUN_TEST(test_load_group_check_failure_restores_the_group);
  RUN_TEST(test_load_group_not_an_object_and_bad_field);
  RUN_TEST(test_load_null_and_non_object_file_add_nothing);
  RUN_TEST(test_paths_ignore_duplicates_and_overflow);
  return UNITY_END();
}
