#include <unity.h>
#include <string.h>
#include "display_fmt.h"

void setUp() {}
void tearDown() {}

static void expectFmt(long n, const char *want) {
  char buf[16];
  formatCount(n, buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING(want, buf);
}

void test_small_counts_are_digits() {
  expectFmt(0, "0");
  expectFmt(9999, "9999");
}

void test_five_digit_counts_are_digits() {
  expectFmt(10000, "10000");
  expectFmt(24553, "24553");
  expectFmt(99999, "99999");
}

void test_six_digit_counts_are_thousands() {
  expectFmt(100000, "100k");
  expectFmt(245999, "245k");
  expectFmt(999999, "999k");
}

void test_millions_have_one_truncated_decimal() {
  expectFmt(1000000, "1.0M");
  expectFmt(1250000, "1.2M");
  expectFmt(1299999, "1.2M");
  expectFmt(9999999, "9.9M");
}

void test_ten_million_and_up_have_no_decimal() {
  expectFmt(10000000, "10M");
  expectFmt(123456789, "123M");
}

void test_negative_is_zero() {
  expectFmt(-5, "0");
}

void test_small_buffer_is_terminated() {
  char buf[4];
  formatCount(24553, buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING("245", buf);
  formatCount(7, buf, 0);                 // no write, no crash
}

void test_follower_text_size() {
  TEST_ASSERT_EQUAL_UINT8(6, followerTextSize("0"));
  TEST_ASSERT_EQUAL_UINT8(6, followerTextSize("9999"));
  TEST_ASSERT_EQUAL_UINT8(5, followerTextSize("10000"));
  TEST_ASSERT_EQUAL_UINT8(5, followerTextSize("99999"));
  TEST_ASSERT_EQUAL_UINT8(6, followerTextSize("245k"));
  TEST_ASSERT_EQUAL_UINT8(6, followerTextSize("1.2M"));
  TEST_ASSERT_EQUAL_UINT8(6, followerTextSize("123M"));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_small_counts_are_digits);
  RUN_TEST(test_five_digit_counts_are_digits);
  RUN_TEST(test_six_digit_counts_are_thousands);
  RUN_TEST(test_millions_have_one_truncated_decimal);
  RUN_TEST(test_ten_million_and_up_have_no_decimal);
  RUN_TEST(test_negative_is_zero);
  RUN_TEST(test_small_buffer_is_terminated);
  RUN_TEST(test_follower_text_size);
  return UNITY_END();
}
