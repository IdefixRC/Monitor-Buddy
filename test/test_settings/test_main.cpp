#include <unity.h>
#include <string.h>
#include <string>
#include <ArduinoJson.h>
#include "settings.h"

void setUp() {}
void tearDown() {}

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
  return UNITY_END();
}
