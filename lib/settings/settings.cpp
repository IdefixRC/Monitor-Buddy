#include "settings.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
