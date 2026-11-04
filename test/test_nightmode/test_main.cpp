#include <unity.h>
#include <stdint.h>
#include "nightmode.h"

void setUp() {}
void tearDown() {}

static void test_window_same_day() {
  TEST_ASSERT_TRUE(inNightWindow(9, 9, 17));
  TEST_ASSERT_TRUE(inNightWindow(16, 9, 17));
  TEST_ASSERT_FALSE(inNightWindow(17, 9, 17));
  TEST_ASSERT_FALSE(inNightWindow(8, 9, 17));
}
static void test_window_crosses_midnight() {
  TEST_ASSERT_TRUE(inNightWindow(23, 23, 7));
  TEST_ASSERT_TRUE(inNightWindow(0, 23, 7));
  TEST_ASSERT_TRUE(inNightWindow(6, 23, 7));
  TEST_ASSERT_FALSE(inNightWindow(7, 23, 7));
  TEST_ASSERT_FALSE(inNightWindow(22, 23, 7));
}
static void test_hour12() {
  TEST_ASSERT_EQUAL(12, hour12(0));
  TEST_ASSERT_EQUAL(9, hour12(9));
  TEST_ASSERT_EQUAL(12, hour12(12));
  TEST_ASSERT_EQUAL(1, hour12(13));
  TEST_ASSERT_EQUAL(11, hour12(23));
}
static void test_night_step_clamps() {
  TEST_ASSERT_EQUAL(32, nightStep(8, true));
  TEST_ASSERT_EQUAL(8, nightStep(8, false));
  TEST_ASSERT_EQUAL(8, nightStep(20, false));
  TEST_ASSERT_EQUAL(255, nightStep(250, true));
}
static void test_level_percent() {
  TEST_ASSERT_EQUAL(3, levelPercent(8));
  TEST_ASSERT_EQUAL(13, levelPercent(32));   // rounds like the flasher's Math.round
  TEST_ASSERT_EQUAL(100, levelPercent(255));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_window_same_day);
  RUN_TEST(test_window_crosses_midnight);
  RUN_TEST(test_hour12);
  RUN_TEST(test_night_step_clamps);
  RUN_TEST(test_level_percent);
  return UNITY_END();
}
