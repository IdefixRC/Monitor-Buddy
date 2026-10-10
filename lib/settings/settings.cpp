#include "settings.h"
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

const char DIGITS[] = "0123456789";
const char ALNUM[]  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Text keys: stored in a char array of `size` bytes inside Settings.
struct TextKey {
  const char *name;
  size_t      offset;
  size_t      size;
  size_t      minLen;
  const char *extra;     // allowed characters besides `base`
  const char *base;
  const char *error;
};

const TextKey TEXT_KEYS[] = {
  {"github_user", offsetof(Settings, githubUser), sizeof(Settings::githubUser), 0,
   "-", ALNUM, "0-39 characters: letters, digits and -"},
  {"tz_name", offsetof(Settings, tzName), sizeof(Settings::tzName), 1,
   "/_+-", ALNUM, "1-64 characters: letters, digits and / _ + -"},
  {"tz_rule", offsetof(Settings, tzRule), sizeof(Settings::tzRule), 1,
   "<>+-:,./", ALNUM, "1-64 characters of a POSIX TZ rule"},
  {"ticker", offsetof(Settings, ticker), sizeof(Settings::ticker), 1,
   "ABCDEFGHIJKLMNOPQRSTUVWXYZ.-", DIGITS, "1-10 characters: A-Z, 0-9, . and -"},
  {"stock_key", offsetof(Settings, stockKey), sizeof(Settings::stockKey), 0,
   "_-", ALNUM, "0-64 characters: letters, digits, _ and -"},
};

// Every top-level key, for "added" and for canonical (static) key names.
const char *const ALL_KEYS[] = {
  "mount", "theme", "github_user", "tz_name", "tz_rule", "ticker", "stock_key",
  "lat", "lon", "temp_unit", "wind_unit", "pages"};

const char *const PAGE_PATHS[SETTINGS_PAGE_COUNT] = {
  "pages.face", "pages.clock", "pages.date", "pages.weather",
  "pages.moon", "pages.stock", "pages.github"};

bool allowedChar(char c, const TextKey &k) {
  return strchr(k.base, c) != nullptr || strchr(k.extra, c) != nullptr;
}

bool applyText(const TextKey &k, JsonVariantConst v, Settings &s, const char *&err) {
  err = k.error;
  if (!v.is<const char *>()) return false;
  const char *str = v.as<const char *>();
  size_t n = strlen(str);
  if (n < k.minLen || n > k.size - 1) return false;
  for (size_t i = 0; i < n; i++)
    if (!allowedChar(str[i], k)) return false;
  memcpy(reinterpret_cast<char *>(&s) + k.offset, str, n + 1);
  return true;
}

bool applyCoordinate(JsonVariantConst v, char *dst, size_t size, double limit,
                     const char *msg, const char *&err) {
  err = msg;
  if (!v.is<const char *>()) return false;
  const char *str = v.as<const char *>();
  size_t n = strlen(str);
  if (n < 1 || n > size - 1) return false;
  char *end = nullptr;
  double d = strtod(str, &end);
  if (end == str || *end != '\0' || !(d >= -limit && d <= limit)) return false;  // also rejects NaN
  memcpy(dst, str, n + 1);
  return true;
}

bool applyChoice(JsonVariantConst v, const char *a, const char *b, bool &isB,
                 const char *msg, const char *&err) {
  err = msg;
  if (!v.is<const char *>()) return false;
  const char *str = v.as<const char *>();
  if (strcmp(str, a) == 0) { isB = false; return true; }
  if (strcmp(str, b) == 0) { isB = true;  return true; }
  return false;
}

// Validates one top-level key (not "pages") and writes it into s on success.
// Returns false and sets err when invalid; s is untouched then.
bool applyKey(const char *key, JsonVariantConst v, Settings &s, const char *&err) {
  for (const TextKey &k : TEXT_KEYS)
    if (strcmp(key, k.name) == 0) return applyText(k, v, s, err);
  if (strcmp(key, "mount") == 0)
    return applyChoice(v, "left", "right", s.mountRight, "must be \"left\" or \"right\"", err);
  if (strcmp(key, "theme") == 0) {
    err = "must be a whole number 0-4";
    if (!v.is<int>()) return false;
    int t = v.as<int>();
    if (t < 0 || t > 4) return false;
    s.theme = (uint8_t)t;
    return true;
  }
  if (strcmp(key, "lat") == 0)
    return applyCoordinate(v, s.lat, sizeof(s.lat), 90.0, "a number from -90 to 90", err);
  if (strcmp(key, "lon") == 0)
    return applyCoordinate(v, s.lon, sizeof(s.lon), 180.0, "a number from -180 to 180", err);
  if (strcmp(key, "temp_unit") == 0)
    return applyChoice(v, "celsius", "fahrenheit", s.tempFahrenheit,
                       "must be \"celsius\" or \"fahrenheit\"", err);
  if (strcmp(key, "wind_unit") == 0)
    return applyChoice(v, "kmh", "mph", s.windMph, "must be \"kmh\" or \"mph\"", err);
  err = "unknown key";
  return false;
}

const char *canonicalKey(const char *key) {
  for (const char *k : ALL_KEYS)
    if (strcmp(key, k) == 0) return k;
  return nullptr;
}

void addKey(AddedKeys &a, const char *key) {
  if (a.count < sizeof(a.keys) / sizeof(a.keys[0])) a.keys[a.count++] = key;
}

// Applies a "pages" object. With `added` set (loading), missing pages are
// recorded; when merging, missing pages simply stay as they are.
bool applyPages(JsonVariantConst v, Settings &s, JsonObject errors, AddedKeys *added) {
  JsonObjectConst obj = v.as<JsonObjectConst>();
  if (obj.isNull()) { errors["pages"] = "must be an object"; return false; }
  bool ok = true;
  for (uint8_t i = 0; i < SETTINGS_PAGE_COUNT; i++) {
    JsonVariantConst p = obj[SETTINGS_PAGE_KEYS[i]];
    if (p.isNull()) { if (added) addKey(*added, PAGE_PATHS[i]); continue; }
    if (!p.is<bool>()) { errors[PAGE_PATHS[i]] = "must be true or false"; ok = false; continue; }
    s.pages[i] = p.as<bool>();
  }
  return ok;
}

}  // namespace

void settingsLoad(const Settings &defaults, JsonVariantConst stored,
                  Settings &out, AddedKeys &added, JsonObject invalid) {
  out = defaults;
  added.count = 0;
  JsonObjectConst obj = stored.as<JsonObjectConst>();
  if (obj.isNull()) return;
  for (const char *key : ALL_KEYS) {
    JsonVariantConst v = obj[key];
    if (v.isNull()) { addKey(added, key); continue; }
    if (strcmp(key, "pages") == 0) { applyPages(v, out, invalid, &added); continue; }
    const char *err = nullptr;
    if (!applyKey(key, v, out, err)) invalid[key] = err;
  }
}

bool settingsMerge(const Settings &current, JsonVariantConst patch,
                   Settings &out, JsonObject errors) {
  out = current;
  JsonObjectConst obj = patch.as<JsonObjectConst>();
  if (obj.isNull()) { errors["config"] = "must be an object"; return false; }
  bool ok = true;
  for (JsonPairConst kv : obj) {
    const char *key = canonicalKey(kv.key().c_str());
    if (!key) continue;                                   // unknown, or "v"
    if (strcmp(key, "pages") == 0) {
      if (!applyPages(kv.value(), out, errors, nullptr)) ok = false;
      continue;
    }
    const char *err = nullptr;
    if (!applyKey(key, kv.value(), out, err)) { errors[key] = err; ok = false; }
  }
  return ok;
}

void settingsToJson(const Settings &s, JsonObject out) {
  out["v"]           = CONFIG_VERSION;
  out["mount"]       = s.mountRight ? "right" : "left";
  out["theme"]       = s.theme;
  out["github_user"] = (const char *)s.githubUser;
  out["tz_name"]     = (const char *)s.tzName;
  out["tz_rule"]     = (const char *)s.tzRule;
  out["ticker"]      = (const char *)s.ticker;
  out["stock_key"]   = (const char *)s.stockKey;
  out["lat"]         = (const char *)s.lat;
  out["lon"]         = (const char *)s.lon;
  out["temp_unit"]   = s.tempFahrenheit ? "fahrenheit" : "celsius";
  out["wind_unit"]   = s.windMph ? "mph" : "kmh";
  JsonObject pages = out["pages"].to<JsonObject>();
  for (uint8_t i = 0; i < SETTINGS_PAGE_COUNT; i++) pages[SETTINGS_PAGE_KEYS[i]] = s.pages[i];
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
  const char *pv = p.isNull() ? "" : (p.is<const char *>() ? p.as<const char *>() : nullptr);
  size_t pn = pv ? strlen(pv) : 0;
  if (!pv || (pn != 0 && (pn < 8 || pn > 63)) || pn >= passLen) {
    errors["wifi.password"] = "must be empty or 8-63 characters";
    ok = false;
  }
  if (!ok) return false;
  memcpy(ssid, sv, sn + 1);
  memcpy(pass, pv, pn + 1);
  return true;
}
