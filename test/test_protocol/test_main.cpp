#include <unity.h>
#include <string.h>
#include <string>
#include "protocol.h"

void setUp() {}
void tearDown() {}

static LineReader reader;   // 2 KB: keep it off the stack

// Feeds a whole string; returns the last result that wasn't NOTHING.
static LineReader::Result feedAll(const std::string &s) {
  LineReader::Result last = LineReader::NOTHING;
  for (char c : s) {
    LineReader::Result r = reader.feed(c);
    if (r != LineReader::NOTHING) last = r;
  }
  return last;
}

static void test_reader_returns_a_line() {
  TEST_ASSERT_EQUAL(LineReader::LINE, feedAll("@MB INFO\n"));
  TEST_ASSERT_EQUAL_STRING("@MB INFO", reader.line());
}

static void test_reader_ignores_carriage_return_and_empty_lines() {
  TEST_ASSERT_EQUAL(LineReader::LINE, feedAll("@MB GET\r\n"));
  TEST_ASSERT_EQUAL_STRING("@MB GET", reader.line());
  TEST_ASSERT_EQUAL(LineReader::NOTHING, feedAll("\n"));
}

static void test_reader_flags_overlong_protocol_line_and_recovers() {
  std::string longLine = "@MB SET " + std::string(2100, 'x') + "\n";
  TEST_ASSERT_EQUAL(LineReader::TOO_LONG, feedAll(longLine));
  TEST_ASSERT_EQUAL(LineReader::LINE, feedAll("@MB INFO\n"));
  TEST_ASSERT_EQUAL_STRING("@MB INFO", reader.line());
}

static void test_reader_drops_overlong_other_line_silently() {
  std::string longLine = std::string(2100, 'x') + "\n";
  TEST_ASSERT_EQUAL(LineReader::NOTHING, feedAll(longLine));
}

static void test_reader_accepts_line_of_exact_capacity() {
  std::string line = "@MB SET " + std::string(LineReader::CAPACITY - 8, 'x');
  TEST_ASSERT_EQUAL(LineReader::LINE, feedAll(line + "\n"));
  TEST_ASSERT_EQUAL(LineReader::CAPACITY, strlen(reader.line()));
}

static void test_parse_commands() {
  const char *arg = nullptr;
  TEST_ASSERT_EQUAL(MB_INFO, mbParse("@MB INFO", &arg));
  TEST_ASSERT_EQUAL_STRING("", arg);
  TEST_ASSERT_EQUAL(MB_GET, mbParse("@MB GET", &arg));
  TEST_ASSERT_EQUAL(MB_REBOOT, mbParse("@MB REBOOT", &arg));
  TEST_ASSERT_EQUAL(MB_SET, mbParse("@MB SET {\"config\":{}}", &arg));
  TEST_ASSERT_EQUAL_STRING("{\"config\":{}}", arg);
}

static void test_parse_rejects_other_lines() {
  const char *arg = nullptr;
  TEST_ASSERT_EQUAL(MB_NONE, mbParse("app=0 mood=0 wifi=up", &arg));
  TEST_ASSERT_EQUAL(MB_NONE, mbParse("@MBINFO", &arg));
  TEST_ASSERT_EQUAL(MB_UNKNOWN, mbParse("@MB INFOX", &arg));
  TEST_ASSERT_EQUAL(MB_UNKNOWN, mbParse("@MB {\"ok\":true}", &arg));
  TEST_ASSERT_EQUAL(MB_UNKNOWN, mbParse("@MB ", &arg));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_reader_returns_a_line);
  RUN_TEST(test_reader_ignores_carriage_return_and_empty_lines);
  RUN_TEST(test_reader_flags_overlong_protocol_line_and_recovers);
  RUN_TEST(test_reader_drops_overlong_other_line_silently);
  RUN_TEST(test_reader_accepts_line_of_exact_capacity);
  RUN_TEST(test_parse_commands);
  RUN_TEST(test_parse_rejects_other_lines);
  return UNITY_END();
}
