#pragma once
// Runtime settings: the values config.h used to fix at compile time, stored
// on the board in /config.json and edited over serial by the web flasher.
// Pure C++ with no Arduino headers, so it is unit-tested on the PC
// (pio test -e native). main.cpp does all file and serial I/O.
#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>
#include "schema.h"

static const int CONFIG_VERSION = 1;
static const uint8_t SETTINGS_PAGE_COUNT = 7;
// Index order matches the PAGE_* ids in main.cpp (face = 0 ... github = 6).
extern const char *const SETTINGS_PAGE_KEYS[SETTINGS_PAGE_COUNT];

// Choice settings are stored as the index of their word.
enum : uint8_t { MOUNT_LEFT = 0, MOUNT_RIGHT = 1 };
enum : uint8_t { TEMP_CELSIUS = 0, TEMP_FAHRENHEIT = 1 };
enum : uint8_t { WIND_KMH = 0, WIND_MPH = 1 };

struct Settings {
  uint8_t mount;              // MOUNT_*
  uint8_t theme;              // 0-4
  char    githubUser[40];     // "" hides the GitHub page
  char    tzName[65];         // IANA name, for the weather request
  char    tzRule[65];         // POSIX TZ rule, for the clock
  char    ticker[11];
  char    stockKey[65];
  char    lat[16];
  char    lon[16];
  uint8_t tempUnit;           // TEMP_*
  uint8_t windUnit;           // WIND_*
  bool    pages[SETTINGS_PAGE_COUNT];
};

// POSIX rule for a fixed UTC offset in hours, rounded to 15 minutes:
// +8 -> "<+08>-8", -5 -> "<-05>5", 0 -> "UTC0". POSIX counts west of UTC as
// positive, so the number's sign is the reverse of the offset's.
// False outside -12..+14 h or when out is too small.
bool tzRuleFromOffset(float hours, char *out, size_t outLen);

// Paths a stored file lacked, so they got their defaults ("ticker",
// "pages.github", ...): keys[0..count).
using AddedKeys = schema::Paths;

// out = defaults, then every valid key from `stored` on top. Missing keys go
// to `added`, invalid ones to `invalid` (key -> message) and keep their
// default. A null or non-object `stored` (no file) adds nothing: there is
// nothing to compare against. Unknown keys are ignored.
void settingsLoad(const Settings &defaults, JsonVariantConst stored,
                  Settings &out, AddedKeys &added, JsonObject invalid);

// out = current with `patch` merged in (a partial object is fine; groups such as "pages"
// merge per field, lists are replaced whole). True only if every known key in the patch is valid;
// otherwise `errors` holds key -> message and out must be discarded.
// Unknown keys and "v" are ignored.
bool settingsMerge(const Settings &current, JsonVariantConst patch,
                   Settings &out, JsonObject errors);

// Every key, plus "v" = CONFIG_VERSION.
void settingsToJson(const Settings &s, JsonObject out);

// {"ssid": 1-32 chars, "password": required; "" for an open network, else
// 8-63 chars}.
// ssidLen must be >= 33 and passLen >= 64.
bool wifiValidate(JsonVariantConst wifi, char *ssid, size_t ssidLen,
                  char *pass, size_t passLen, JsonObject errors);
