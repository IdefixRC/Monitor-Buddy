#pragma once
// Text helpers for the display pages. Pure C++ with no Arduino headers, so
// they are unit-tested on the PC (pio test -e native). The browser preview
// has the same two functions in web/js/preview.js. KEEP IN SYNC.
#include <stddef.h>
#include <stdint.h>

// Formats a count so it fits the screen:
//   0-99999        the digits            ("24553")
//   100000-999999  thousands + "k"       ("245k")
//   1000000-9999999   one decimal, truncated, + "M"  ("1.2M")
//   10000000 and up   millions + "M"     ("12M")
//   negative       "0"
// Always writes a terminated string (nothing if len is 0).
void formatCount(long n, char *out, size_t len);

// Text size for the big follower number: 5 for exactly 5 characters (5 digits
// at size 6 would be 180 px and run off the 320 px screen from x=150), else 6.
uint8_t followerTextSize(const char *formatted);
