#include <unity.h>
#include <fstream>
#include <sstream>
#include <string>
#include <string.h>
#include "coin.h"

void setUp() {}
void tearDown() {}

static std::string fixture(const char *name) {
  std::ifstream f(std::string("test/fixtures/") + name, std::ios::binary);
  std::stringstream ss; ss << f.rdbuf(); return ss.str();
}

static void test_candles_oldest_first() {
  float pts[24];
  const uint8_t n = parseCandleCloses(fixture("coinbase-candles.json").c_str(), pts, 24);
  TEST_ASSERT_EQUAL(4, n);
  TEST_ASSERT_EQUAL_FLOAT(77000.0f, pts[0]);
  TEST_ASSERT_EQUAL_FLOAT(77309.65f, pts[3]);
}
static void test_candles_max_takes_the_newest() {
  float pts[2];
  TEST_ASSERT_EQUAL(2, parseCandleCloses(fixture("coinbase-candles.json").c_str(), pts, 2));
  TEST_ASSERT_EQUAL_FLOAT(77208.14f, pts[0]);
  TEST_ASSERT_EQUAL_FLOAT(77309.65f, pts[1]);
}
static void test_candles_reject_garbage() {
  float pts[24];
  TEST_ASSERT_EQUAL(0, parseCandleCloses("{\"message\":\"NotFound\"}", pts, 24));
  TEST_ASSERT_EQUAL(0, parseCandleCloses("[[1,2,3]]", pts, 24));
  TEST_ASSERT_EQUAL(0, parseCandleCloses("[[1,1,1,1,1,1],[2,1,1,1,1,1]]", pts, 24));   // oldest first
}
static void test_price_format() {
  char b[24];
  formatCoinPrice(104532.123, b, sizeof b);  TEST_ASSERT_EQUAL_STRING("104532.12", b);
  formatCoinPrice(1.0, b, sizeof b);         TEST_ASSERT_EQUAL_STRING("1.00", b);
  formatCoinPrice(0.12345, b, sizeof b);     TEST_ASSERT_EQUAL_STRING("0.1235", b);
  formatCoinPrice(0.00001234, b, sizeof b);  TEST_ASSERT_EQUAL_STRING("0.00001234", b);
  formatCoinPrice(0.0, b, sizeof b);         TEST_ASSERT_EQUAL_STRING("0.00", b);
  formatCoinPrice(INFINITY, b, sizeof b);    TEST_ASSERT_EQUAL_STRING("0.00", b);
  formatCoinPrice(-INFINITY, b, sizeof b);   TEST_ASSERT_EQUAL_STRING("0.00", b);
  formatCoinPrice(NAN, b, sizeof b);         TEST_ASSERT_EQUAL_STRING("0.00", b);
}
static void test_currency() {
  char c[8];
  TEST_ASSERT_EQUAL(CUR_DOLLAR, currencyOf("BTC-USD", c, sizeof c));
  TEST_ASSERT_EQUAL(CUR_DOLLAR, currencyOf("BTC-USDT", c, sizeof c));
  TEST_ASSERT_EQUAL(CUR_POUND, currencyOf("ETH-GBP", c, sizeof c));
  TEST_ASSERT_EQUAL(CUR_EURO, currencyOf("SOL-EUR", c, sizeof c));
  TEST_ASSERT_EQUAL(CUR_CODE, currencyOf("BTC-SGD", c, sizeof c));
  TEST_ASSERT_EQUAL_STRING("SGD", c);
}
static void test_iso_utc() {
  char b[24];
  TEST_ASSERT_TRUE(formatIsoUtc(1793437200LL, b, sizeof b));
  TEST_ASSERT_EQUAL_STRING("2026-10-31T09:00:00Z", b);
  TEST_ASSERT_TRUE(formatIsoUtc(951782400LL, b, sizeof b));     // 2000-02-29, a leap day
  TEST_ASSERT_EQUAL_STRING("2000-02-29T00:00:00Z", b);
  TEST_ASSERT_FALSE(formatIsoUtc(0, b, 10));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_candles_oldest_first);
  RUN_TEST(test_candles_max_takes_the_newest);
  RUN_TEST(test_candles_reject_garbage);
  RUN_TEST(test_price_format);
  RUN_TEST(test_currency);
  RUN_TEST(test_iso_utc);
  return UNITY_END();
}
