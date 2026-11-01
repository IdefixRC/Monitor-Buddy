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

void formatSubHint(char *out, size_t outLen, uint8_t index, uint8_t count) {
  if (outLen == 0) return;
  if (count < 2) { out[0] = '\0'; return; }
  snprintf(out, outLen, "%u/%u", (unsigned)(index + 1), (unsigned)count);
}
