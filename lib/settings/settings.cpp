#include "settings.h"
#include "schema.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

const char *const SETTINGS_PAGE_KEYS[SETTINGS_PAGE_COUNT] = {
  "face", "clock", "date", "weather", "moon", "stock", "github"};

bool tzRuleFromOffset(float hours, char *out, size_t outLen) {
  if (!(hours >= -12.0f && hours <= 14.0f)) return false;
  long minutes = lroundf(hours * 4.0f) * 15;          // nearest quarter hour
  int n;
  if (minutes == 0) {
    n = snprintf(out, outLen, "UTC0");
  } else {
    char sign = minutes > 0 ? '+' : '-';
    const char *posixSign = minutes > 0 ? "-" : "";   // reversed, see header
    long a = labs(minutes), h = a / 60, m = a % 60;
    if (m == 0)
      n = snprintf(out, outLen, "<%c%02ld>%s%ld", sign, h, posixSign, h);
    else
      n = snprintf(out, outLen, "<%c%02ld%02ld>%s%ld:%02ld", sign, h, m, posixSign, h, m);
  }
  return n > 0 && (size_t)n < outLen;
}

namespace {

using schema::Field;

#define DIGITS_ "0123456789"
#define UPPER_  "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
#define ALNUM_  UPPER_ "abcdefghijklmnopqrstuvwxyz" DIGITS_
#define AT(member) (uint16_t)offsetof(Settings, member)

const char *const MOUNT_WORDS[] = {"left", "right"};
const char *const TEMP_WORDS[]  = {"celsius", "fahrenheit"};
const char *const WIND_WORDS[]  = {"kmh", "mph"};
const char *const MSG_PAGE = "must be true or false";

const Field PAGE_FIELDS[SETTINGS_PAGE_COUNT] = {
  schema::boolField("face",    0 * sizeof(bool), MSG_PAGE),
  schema::boolField("clock",   1 * sizeof(bool), MSG_PAGE),
  schema::boolField("date",    2 * sizeof(bool), MSG_PAGE),
  schema::boolField("weather", 3 * sizeof(bool), MSG_PAGE),
  schema::boolField("moon",    4 * sizeof(bool), MSG_PAGE),
  schema::boolField("stock",   5 * sizeof(bool), MSG_PAGE),
  schema::boolField("github",  6 * sizeof(bool), MSG_PAGE),
};

// Every setting, in 1.2.0's key order (GET and /config.json follow it).
// The messages are 1.2.0's, word for word: web/js/settings.js and
// test/fixtures/settings-cases.json depend on them.
const Field SETTINGS_FIELDS[] = {
  schema::choiceField("mount", AT(mount), MOUNT_WORDS, 2, "must be \"left\" or \"right\""),
  schema::intField("theme", AT(theme), 1, 0, 4, "must be a whole number 0-4"),
  schema::textField("github_user", AT(githubUser), sizeof(Settings::githubUser), 0,
                    ALNUM_ "-", "0-39 characters: letters, digits and -"),
  schema::textField("tz_name", AT(tzName), sizeof(Settings::tzName), 1,
                    ALNUM_ "/_+-", "1-64 characters: letters, digits and / _ + -"),
  schema::textField("tz_rule", AT(tzRule), sizeof(Settings::tzRule), 1,
                    ALNUM_ "<>+-:,./", "1-64 characters of a POSIX TZ rule"),
  schema::textField("ticker", AT(ticker), sizeof(Settings::ticker), 1,
                    UPPER_ DIGITS_ ".-", "1-10 characters: A-Z, 0-9, . and -"),
  schema::textField("stock_key", AT(stockKey), sizeof(Settings::stockKey), 0,
                    ALNUM_ "_-", "0-64 characters: letters, digits, _ and -"),
  schema::coordField("lat", AT(lat), sizeof(Settings::lat), 90, "a number from -90 to 90"),
  schema::coordField("lon", AT(lon), sizeof(Settings::lon), 180, "a number from -180 to 180"),
  schema::choiceField("temp_unit", AT(tempUnit), TEMP_WORDS, 2, "must be \"celsius\" or \"fahrenheit\""),
  schema::choiceField("wind_unit", AT(windUnit), WIND_WORDS, 2, "must be \"kmh\" or \"mph\""),
  schema::groupField("pages", AT(pages), sizeof(Settings::pages), PAGE_FIELDS, SETTINGS_PAGE_COUNT),
};
const uint8_t SETTINGS_FIELD_COUNT = sizeof(SETTINGS_FIELDS) / sizeof(SETTINGS_FIELDS[0]);

}  // namespace

void settingsLoad(const Settings &defaults, JsonVariantConst stored,
                  Settings &out, AddedKeys &added, JsonObject invalid) {
  schema::load(SETTINGS_FIELDS, SETTINGS_FIELD_COUNT, &defaults, stored, &out, sizeof(Settings),
               added, invalid);
}

bool settingsMerge(const Settings &current, JsonVariantConst patch,
                   Settings &out, JsonObject errors) {
  return schema::merge(SETTINGS_FIELDS, SETTINGS_FIELD_COUNT, &current, patch, &out,
                       sizeof(Settings), errors);
}

void settingsToJson(const Settings &s, JsonObject out) {
  out["v"] = CONFIG_VERSION;
  schema::toJson(SETTINGS_FIELDS, SETTINGS_FIELD_COUNT, &s, out);
}

bool wifiValidate(JsonVariantConst wifi, char *ssid, size_t ssidLen,
                  char *pass, size_t passLen, JsonObject errors) {
  JsonObjectConst obj = wifi.as<JsonObjectConst>();
  if (obj.isNull()) { errors["wifi"] = "must be an object"; return false; }
  bool ok = true;
  JsonVariantConst s = obj["ssid"];
  const char *sv = s.is<const char *>() ? s.as<const char *>() : nullptr;
  size_t sn = sv ? strlen(sv) : 0;
  if (!sv || sn < 1 || sn > 32 || sn >= ssidLen) {
    errors["wifi.ssid"] = "must be 1-32 characters";
    ok = false;
  }
  JsonVariantConst p = obj["password"];
  const char *pv = p.is<const char *>() ? p.as<const char *>() : nullptr;
  size_t pn = pv ? strlen(pv) : 0;
  if (!pv) {
    // Required, so a client can't save an open network by forgetting the field.
    errors["wifi.password"] = "must be text (empty for an open network)";
    ok = false;
  } else if ((pn != 0 && (pn < 8 || pn > 63)) || pn >= passLen) {
    errors["wifi.password"] = "must be empty or 8-63 characters";
    ok = false;
  }
  if (!ok) return false;
  memcpy(ssid, sv, sn + 1);
  memcpy(pass, pv, pn + 1);
  return true;
}
