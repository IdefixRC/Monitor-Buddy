#pragma once
// Night mode and clock helpers. Pure C++ with no Arduino headers, so they are
// unit-tested on the PC (pio test -e native) and compiled into the firmware.
#include <stdint.h>

// True when `hour` is in [start, end). The window may cross midnight
// (start > end, e.g. 23 to 7).
bool inNightWindow(uint8_t hour, uint8_t start, uint8_t end);

// 12-hour clock face: 0 -> 12, 13 -> 1, 12 -> 12.
uint8_t hour12(uint8_t hour);

// Brightness level stepped by +-24, clamped to 8..255.
uint8_t nightStep(uint8_t level, bool up);

// Level as a percentage (level * 100 / 255), as the banner shows it.
uint8_t levelPercent(uint8_t level);
