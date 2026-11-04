#include "nightmode.h"

bool inNightWindow(uint8_t h, uint8_t start, uint8_t end) {
  return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

uint8_t hour12(uint8_t h) {
  h %= 12;
  return h == 0 ? 12 : h;
}

uint8_t nightStep(uint8_t level, bool up) {
  const int v = (int)level + (up ? 24 : -24);
  return (uint8_t)(v < 8 ? 8 : v > 255 ? 255 : v);
}

uint8_t levelPercent(uint8_t level) {
  return (uint8_t)(level * 100UL / 255UL);
}
