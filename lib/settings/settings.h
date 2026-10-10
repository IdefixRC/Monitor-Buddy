#pragma once
// Runtime settings: the values config.h used to fix at compile time, stored
// on the board in /config.json and edited over serial by the web flasher.
// Pure C++ with no Arduino headers, so it is unit-tested on the PC
// (pio test -e native). main.cpp does all file and serial I/O.
#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>

static const int CONFIG_VERSION = 1;
static const uint8_t SETTINGS_PAGE_COUNT = 7;
// Index order matches the PAGE_* ids in main.cpp (face = 0 ... github = 6).
extern const char *const SETTINGS_PAGE_KEYS[SETTINGS_PAGE_COUNT];

struct Settings {
  bool    mountRight;
  uint8_t theme;              // 0-4
  char    githubUser[40];     // "" hides the GitHub page
  char    tzName[65];         // IANA name, for the weather request
  char    tzRule[65];         // POSIX TZ rule, for the clock
  char    ticker[11];
  char    stockKey[65];
  char    lat[16];
  char    lon[16];
  bool    tempFahrenheit;
  bool    windMph;
  bool    pages[SETTINGS_PAGE_COUNT];
};

// POSIX rule for a fixed UTC offset in hours, rounded to 15 minutes:
// +8 -> "<+08>-8", -5 -> "<-05>5", 0 -> "UTC0". POSIX counts west of UTC as
// positive, so the number's sign is the reverse of the offset's.
// False outside -12..+14 h or when out is too small.
bool tzRuleFromOffset(float hours, char *out, size_t outLen);
