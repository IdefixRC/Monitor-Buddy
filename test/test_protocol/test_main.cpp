#include <unity.h>
#include <string.h>
#include <string>
#include <ArduinoJson.h>
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

static void test_parse_defaults() {
  const char *arg = nullptr;
  TEST_ASSERT_EQUAL(MB_DEFAULTS, mbParse("@MB DEFAULTS", &arg));
  TEST_ASSERT_EQUAL_STRING("", arg);
  TEST_ASSERT_EQUAL(MB_DEFAULTS, mbParse("@MB DEFAULTS {\"id\":3}", &arg));
  TEST_ASSERT_EQUAL_STRING("{\"id\":3}", arg);
  TEST_ASSERT_EQUAL(MB_UNKNOWN, mbParse("@MB DEFAULT", &arg));
  TEST_ASSERT_EQUAL(MB_UNKNOWN, mbParse("@MB defaults", &arg));
}

static void test_command_word() {
  char w[17];
  mbCommandWord("@MB INFO", w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("INFO", w);
  mbCommandWord("@MB SET {\"config\":{}}", w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("SET", w);
  mbCommandWord("@MB HELLO there", w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("HELLO", w);
}

static void test_command_word_truncates_at_16() {
  char w[17];
  mbCommandWord("@MB ABCDEFGHIJKLMNOPQRSTUVWXYZ", w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", w);          // 16 characters
  mbCommandWord("@MB ABCDEFGHIJKLMNOP", w, sizeof(w));       // exactly 16
  TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", w);
  mbCommandWord("@MB ABCDEFGHIJKLMNOPQ x", w, sizeof(w));    // 17 before the space
  TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", w);
  char small[4];                                              // the buffer size wins
  mbCommandWord("@MB ABCDEFGHIJ", small, sizeof(small));
  TEST_ASSERT_EQUAL_STRING("ABC", small);
}

static void test_command_word_edge_cases() {
  char w[17];
  mbCommandWord("@MB REBOOT", w, sizeof(w));                  // no space, no argument
  TEST_ASSERT_EQUAL_STRING("REBOOT", w);
  mbCommandWord("@MB ", w, sizeof(w));                        // the prefix alone
  TEST_ASSERT_EQUAL_STRING("", w);
  mbCommandWord("@MB  GET", w, sizeof(w));                    // word starts at a space
  TEST_ASSERT_EQUAL_STRING("", w);
  mbCommandWord("hello", w, sizeof(w));                       // no prefix at all
  TEST_ASSERT_EQUAL_STRING("", w);
  w[0] = 'x';
  mbCommandWord("@MB GET", w, 0);                             // no room: must not write
  TEST_ASSERT_EQUAL_CHAR('x', w[0]);
}

static void test_command_word_of_a_too_long_line() {
  std::string longLine = "@MB SET " + std::string(2100, 'x') + "\n";
  TEST_ASSERT_EQUAL(LineReader::TOO_LONG, feedAll(longLine));
  char w[17];
  mbCommandWord(reader.line(), w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("SET", w);
  std::string longWord = "@MB " + std::string(2100, 'y') + "\n";
  TEST_ASSERT_EQUAL(LineReader::TOO_LONG, feedAll(longWord));
  mbCommandWord(reader.line(), w, sizeof(w));
  TEST_ASSERT_EQUAL_STRING("yyyyyyyyyyyyyyyy", w);
  TEST_ASSERT_EQUAL(LineReader::LINE, feedAll("@MB INFO\n"));   // reader recovered
}

static void test_arg_empty() {
  JsonDocument body;
  bool hasId = true;
  int32_t id = 99;
  TEST_ASSERT_EQUAL(MB_ARG_OK, mbParseArg("", body, hasId, id));
  TEST_ASSERT_FALSE(hasId);
  TEST_ASSERT_TRUE(body.isNull());
}

static void test_arg_object_without_id() {
  JsonDocument body;
  bool hasId = true;
  int32_t id = 0;
  TEST_ASSERT_EQUAL(MB_ARG_OK, mbParseArg("{}", body, hasId, id));
  TEST_ASSERT_FALSE(hasId);
  TEST_ASSERT_TRUE(body.is<JsonObject>());
}

static void test_arg_valid_ids() {
  struct { const char *arg; int32_t id; } cases[] = {
    {"{\"id\":7}", 7}, {"{\"id\":0}", 0}, {"{\"id\":2147483647}", 2147483647}};
  for (const auto &c : cases) {
    JsonDocument body;
    bool hasId = false;
    int32_t id = -5;
    TEST_ASSERT_EQUAL_MESSAGE(MB_ARG_OK, mbParseArg(c.arg, body, hasId, id), c.arg);
    TEST_ASSERT_TRUE_MESSAGE(hasId, c.arg);
    TEST_ASSERT_EQUAL_INT32_MESSAGE(c.id, id, c.arg);
  }
}

static void test_arg_bad_ids() {
  const char *cases[] = {
    "{\"id\":-1}", "{\"id\":\"7\"}", "{\"id\":2147483648}", "{\"id\":1.5}",
    "{\"id\":null}", "{\"id\":true}", "{\"id\":[7]}", "{\"id\":{}}",
    "{\"id\":-2147483649}", "{\"id\":99999999999999999999}"};
  for (const char *arg : cases) {
    JsonDocument body;
    bool hasId = true;
    int32_t id = 0;
    TEST_ASSERT_EQUAL_MESSAGE(MB_ARG_BAD_ID, mbParseArg(arg, body, hasId, id), arg);
    TEST_ASSERT_FALSE_MESSAGE(hasId, arg);
  }
}

static void test_arg_bad_json() {
  const char *cases[] = {"[1]", "{bad", "7", "\"id\"", "true", "null", "{\"id\":7", " "};
  for (const char *arg : cases) {
    JsonDocument body;
    bool hasId = true;
    int32_t id = 0;
    TEST_ASSERT_EQUAL_MESSAGE(MB_ARG_BAD_JSON, mbParseArg(arg, body, hasId, id), arg);
    TEST_ASSERT_FALSE_MESSAGE(hasId, arg);
  }
}

static void test_arg_set_body_with_id_and_config() {
  JsonDocument body;
  bool hasId = false;
  int32_t id = 0;
  TEST_ASSERT_EQUAL(MB_ARG_OK,
      mbParseArg("{\"id\":8,\"config\":{\"ticker\":\"AVGO\",\"theme\":2}}", body, hasId, id));
  TEST_ASSERT_TRUE(hasId);
  TEST_ASSERT_EQUAL_INT32(8, id);
  TEST_ASSERT_EQUAL_STRING("AVGO", body["config"]["ticker"].as<const char *>());
  TEST_ASSERT_EQUAL(2, body["config"]["theme"].as<int>());
}

static void test_arg_bad_id_beats_other_content() {
  JsonDocument body;
  bool hasId = false;
  int32_t id = 0;
  TEST_ASSERT_EQUAL(MB_ARG_BAD_ID,
      mbParseArg("{\"id\":\"x\",\"config\":{\"theme\":2}}", body, hasId, id));
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
  RUN_TEST(test_parse_defaults);
  RUN_TEST(test_command_word);
  RUN_TEST(test_command_word_truncates_at_16);
  RUN_TEST(test_command_word_edge_cases);
  RUN_TEST(test_command_word_of_a_too_long_line);
  RUN_TEST(test_arg_empty);
  RUN_TEST(test_arg_object_without_id);
  RUN_TEST(test_arg_valid_ids);
  RUN_TEST(test_arg_bad_ids);
  RUN_TEST(test_arg_bad_json);
  RUN_TEST(test_arg_set_body_with_id_and_config);
  RUN_TEST(test_arg_bad_id_beats_other_content);
  return UNITY_END();
}
