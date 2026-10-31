#pragma once
// A table-driven settings engine. One Field row per setting describes its JSON
// name, its kind, its rules and where it lives in a plain struct; load, merge
// and toJson walk the table, so a new setting is a new row (spec 2026-10-31
// settings-schema §3). Pure C++ with no Arduino headers: unit-tested on the PC.
#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>

namespace schema {

enum class Kind : uint8_t { Bool, Int, Choice, Text, Coord, Group, List };

// Offsets are from the parent's base: the struct for top-level rows, the group
// for a group's fields, one entry for a list's fields.
struct Field {
  const char *name;          // JSON key; nullptr for the single value of a value list
  Kind        kind;
  uint16_t    offset;
  uint8_t     width;         // Int: 1 (uint8_t) or 2 (int16_t); Text, Coord: char array size
  int16_t     lo, hi;        // Int: value; Text: length; Coord: hi = limit; List: entry count
  const char *chars;         // Text: allowed characters
  const char *const *words;  // Choice: allowed words, in index order
  uint8_t     wordCount;
  const char *error;         // message for any invalid value (Group: for a failed check)
  bool (*check)(const uint8_t *value);  // optional; Text: the string, Group: the group
  const Field *children;     // Group: its fields; List: the entry's field(s)
  uint8_t     childCount;
  uint16_t    stride;        // Group: its size in bytes; List: one entry's size
  uint16_t    countOffset;   // List: offset of its uint8_t count, from the parent's base
  const void *entryDefault;  // List of records: one entry holding each field's default
};

constexpr Field boolField(const char *name, uint16_t at, const char *error) {
  return Field{name, Kind::Bool, at, 1, 0, 0, nullptr, nullptr, 0, error, nullptr, nullptr, 0, 0, 0, nullptr};
}
constexpr Field intField(const char *name, uint16_t at, uint8_t width, int16_t lo, int16_t hi,
                         const char *error) {
  return Field{name, Kind::Int, at, width, lo, hi, nullptr, nullptr, 0, error, nullptr, nullptr, 0, 0, 0, nullptr};
}
constexpr Field choiceField(const char *name, uint16_t at, const char *const *words, uint8_t count,
                            const char *error) {
  return Field{name, Kind::Choice, at, 1, 0, 0, nullptr, words, count, error, nullptr, nullptr, 0, 0, 0, nullptr};
}
constexpr Field textField(const char *name, uint16_t at, uint8_t size, int16_t minLen,
                          const char *chars, const char *error,
                          bool (*check)(const uint8_t *) = nullptr) {
  return Field{name, Kind::Text, at, size, minLen, (int16_t)(size - 1), chars, nullptr, 0, error, check,
               nullptr, 0, 0, 0, nullptr};
}
constexpr Field coordField(const char *name, uint16_t at, uint8_t size, int16_t limit,
                           const char *error) {
  return Field{name, Kind::Coord, at, size, 0, limit, nullptr, nullptr, 0, error, nullptr, nullptr, 0, 0, 0, nullptr};
}
constexpr Field groupField(const char *name, uint16_t at, uint16_t size, const Field *children,
                           uint8_t count, const char *error = nullptr,
                           bool (*check)(const uint8_t *) = nullptr) {
  return Field{name, Kind::Group, at, 0, 0, 0, nullptr, nullptr, 0, error, check, children, count, size, 0, nullptr};
}
constexpr Field listField(const char *name, uint16_t at, uint16_t countAt, uint16_t stride,
                          int16_t lo, int16_t hi, const Field *children, uint8_t count,
                          const char *error, const void *entryDefault = nullptr) {
  return Field{name, Kind::List, at, 0, lo, hi, nullptr, nullptr, 0, error, nullptr, children, count, stride,
               countAt, entryDefault};
}

extern const char *const MSG_OBJECT;   // "must be an object"

// Paths reported as added (copies, so built paths like "coins.style" fit).
struct Paths {
  static constexpr uint8_t MAX = 32;
  static constexpr uint8_t LEN = 32;
  char    keys[MAX][LEN];
  uint8_t count = 0;
  bool has(const char *path) const;
  void add(const char *path);   // ignores duplicates and overflow
};

// out = defaults, then every valid value from `stored`. Missing → `added`,
// invalid → `invalid` (path → message) with the default kept. A list with any
// bad entry, or a group whose check fails, falls back to its default whole.
// A null or non-object `stored` adds nothing. Unknown keys are ignored.
void load(const Field *t, uint8_t n, const void *defaults, JsonVariantConst stored,
          void *out, size_t size, Paths &added, JsonObject invalid);

// out = current with `patch` merged in. True only if every known value in the
// patch is valid; otherwise `errors` has path → message and out is to be
// discarded. Groups merge per field, lists are replaced whole. Unknown keys
// (and "v") are skipped.
bool merge(const Field *t, uint8_t n, const void *current, JsonVariantConst patch,
           void *out, size_t size, JsonObject errors);

// Every row, in table order.
void toJson(const Field *t, uint8_t n, const void *s, JsonObject out);

}  // namespace schema
