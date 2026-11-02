#include "coin.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Parser ported from PR #22 (Killo1988).
uint8_t parseCandleCloses(const char *s, float *out, uint8_t max) {
  const uint8_t CAP = 24;
  const char *p = strchr(s, '[');                 // the outer array
  if (!p) return 0;
  p++;
  float  newestFirst[CAP];
  double prevTime = 0;
  uint8_t n = 0;
  if (max > CAP) max = CAP;
  while (n < max) {
    p = strchr(p, '[');                           // the next candle
    if (!p) break;
    p++;
    double v[5];
    uint8_t k = 0;
    while (k < 5) {
      char *end;
      v[k] = strtod(p, &end);
      if (end == p) break;                        // not a number
      k++;
      p = end;
      while (*p == ' ') p++;
      if (*p != ',') break;
      p++;
    }
    if (k < 5) return 0;                          // malformed candle
    if (n > 0 && !(v[0] < prevTime)) return 0;    // not newest first
    prevTime = v[0];
    newestFirst[n++] = (float)v[4];               // close
  }
  for (uint8_t i = 0; i < n; i++) out[i] = newestFirst[n - 1 - i];
  return n;
}

void formatCoinPrice(double v, char *out, size_t len) {
  if (!(v > 0.0) || isinf(v)) { snprintf(out, len, "0.00"); return; }
  if (v >= 1.0)   { snprintf(out, len, "%.2f", v); return; }
  // 4 significant digits below 1: decimals = 3 - floor(log10(v)).
  int decimals = 3 - (int)floor(log10(v));
  if (decimals > 12) decimals = 12;
  snprintf(out, len, "%.*f", decimals, v);
}

CurrencyMark currencyOf(const char *pair, char *code, size_t codeLen) {
  const char *quote = strchr(pair, '-');
  quote = quote ? quote + 1 : pair;
  if (code && codeLen) snprintf(code, codeLen, "%s", quote);
  if (!strcmp(quote, "USD") || !strcmp(quote, "USDT")) return CUR_DOLLAR;
  if (!strcmp(quote, "GBP")) return CUR_POUND;
  if (!strcmp(quote, "EUR")) return CUR_EURO;
  return CUR_CODE;
}

bool formatIsoUtc(long long epochSeconds, char *out, size_t len) {
  if (len < 21) return false;
  long long days = epochSeconds / 86400;
  long long rem  = epochSeconds % 86400;
  if (rem < 0) { rem += 86400; days--; }
  // Howard Hinnant's civil_from_days.
  days += 719468;
  const long long era = (days >= 0 ? days : days - 146096) / 146097;
  const long long doe = days - era * 146097;
  const long long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const long long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const long long mp  = (5 * doy + 2) / 153;
  const int d = (int)(doy - (153 * mp + 2) / 5 + 1);
  const int m = (int)(mp < 10 ? mp + 3 : mp - 9);
  const int y = (int)(yoe + era * 400 + (m <= 2));
  snprintf(out, len, "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d,
           (int)(rem / 3600), (int)(rem % 3600 / 60), (int)(rem % 60));
  return true;
}
