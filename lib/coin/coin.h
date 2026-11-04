#pragma once
// Coin page helpers. Pure C++ with no Arduino headers, so they are unit-tested
// on the PC (pio test -e native) and compiled into the firmware.
#include <stddef.h>
#include <stdint.h>

// Closes of the newest `max` candles (at most 24), written oldest first. Returns
// how many it found, or 0 when the text isn't a newest-first array of candles.
uint8_t parseCandleCloses(const char *json, float *out, uint8_t max);

// Price text without a currency symbol: v >= 1 gives "%.2f", 0 < v < 1 gives 4
// significant digits with no exponent ("0.1235", "0.00001234"), v <= 0 gives "0.00".
void formatCoinPrice(double v, char *out, size_t len);

enum CurrencyMark : uint8_t { CUR_DOLLAR, CUR_POUND, CUR_EURO, CUR_CODE };

// From the quote part of a pair after "-": USD/USDT -> CUR_DOLLAR, GBP -> CUR_POUND,
// EUR -> CUR_EURO, anything else -> CUR_CODE with the quote copied into `code`.
CurrencyMark currencyOf(const char *pair, char *code, size_t codeLen);

// "2026-11-02T08:05:00Z" for a UTC epoch; false when len < 21.
bool formatIsoUtc(long long epochSeconds, char *out, size_t len);
