#include "display_fmt.h"
#include <stdio.h>
#include <string.h>

void formatCount(long n, char *out, size_t len) {
  if (len == 0) return;
  if (n < 0) n = 0;
  if (n < 100000L) {
    snprintf(out, len, "%ld", n);
  } else if (n < 1000000L) {
    snprintf(out, len, "%ldk", n / 1000L);
  } else if (n < 10000000L) {
    long tenths = n / 100000L;                       // truncated, not rounded
    snprintf(out, len, "%ld.%ldM", tenths / 10L, tenths % 10L);
  } else {
    snprintf(out, len, "%ldM", n / 1000000L);
  }
}

uint8_t followerTextSize(const char *formatted) {
  return (formatted && strlen(formatted) == 5) ? 5 : 6;
}

// The centre y of entry dot `index` in the right-edge column (stock and coin
// pages): `count` dots 14 px apart, centred on the screen's middle.
int subDotY(uint8_t index, uint8_t count, int screenH) {
  return screenH / 2 - ((count - 1) * 14) / 2 + index * 14;
}
