// ============================================================
// Monitor-Buddy — Waveshare ESP32-C6-Touch-LCD-1.47
// by IdefixRC - https://github.com/IdefixRC
// Features: animated faces, clock, date, weather, moon,
//           stock ticker, GitHub stats.  
//           5 different themes available,
//           Enable/Disable pages to customize your Buddy
//           Touch swipe to change pages, 
//           double tap to stop auto scrolling;
//           WifiManager creates a Wi-Fi hotspot with a
//           captive portal so you can set your Wi-Fi up;
//           tilt via QMI8658 IMU animates eyes.
//
// ------------------------------------------------------------
// ACKNOWLEDGEMENTS
// ------------------------------------------------------------
// Monitor Buddy uses ideas and code snippets from a few other creators
// Initial Baseline Idea: schematik.io - Tiny ESP DeskBuddy
// Additional Faces: https://github.com/EDISON-SCIENCE-CORNER/DESKBUDDY-1.0
//
// ------------------------------------------------------------
//  !! BEFORE YOU FLASH — READ THIS !!
// ------------------------------------------------------------
//  1) Install libraries (Arduino IDE → Library Manager):
//       - AyresWiFiManager   (>= 2.0.2)
//       - ArduinoJson        (v7.x — this sketch uses JsonDocument)
//     Note: AWM internally uses the older StaticJsonDocument /
//     DynamicJsonDocument names. Under ArduinoJson 7 those still
//     compile but emit *deprecation warnings*. Warnings only —
//     the build succeeds. Do not "fix" them by downgrading to v6,
//     that would break this sketch's JsonDocument usage.
//
//  2) UPLOAD THE PORTAL HTML TO LittleFS. This is mandatory.
//     AWM serves the portal from the filesystem; if /index.html
//     is missing the portal answers HTTP 500 and you cannot
//     configure anything.
//       - index.html, success.html and error.html are in the
//         data/  folder
//       - Arduino IDE: Tools → "ESP32 LittleFS Data Upload"
//         (install the arduino-littlefs-upload plugin first)
//       - PlatformIO:  pio run --target uploadfs
//     This sketch checks for /index.html at boot and shows a
//     "PORTAL FILES MISSING" warning on the LCD if it is absent.
//
//  3) Partition scheme must include SPIFFS/LittleFS:
//     Tools → Partition Scheme → "Default 4MB with spiffs" or
//     "Huge APP (3MB No OTA/1MB SPIFFS)". A "No FS" scheme will
//     make LittleFS.begin() fail.
//
// ------------------------------------------------------------
//  HOW TO CONFIGURE WI-FI
// ------------------------------------------------------------
//  Automatically: if there are no stored credentials, or the
//  stored ones fail to connect, the captive portal opens by
//  itself at boot (FallbackPolicy::ON_FAIL).
//
//  On demand: PRESS AND HOLD ANYWHERE ON THE TOUCH SCREEN for
//  ~2.5 s. Works from any page, at any time.
//
//  Hardware fallback: within the first 2 s after power-up, press
//  and hold the BOOT button (GPIO9): 2–5 s opens the portal,
//  >= 5 s erases the stored credentials and reboots.
//  (Do NOT hold BOOT *through* reset — that enters USB download
//  mode. Power up first, then press.)
//
//  Then: join the Wi-Fi network  "Monitor-Buddy-Setup"
//        password                "buddy1234"
//        browse to               http://192.168.4.1
//        (most phones pop the portal open automatically)
//  Pick your network, enter the password, save. The board stores
//  the credentials in LittleFS (/wifi.json) and reboots.
//
// ------------------------------------------------------------
//  HOW TO USE
// ------------------------------------------------------------
// To customize Monitor-Buddy to you, a few entries are required below:
// Github: 	  Replace IdefixRC with your own github username
// Time: 	    Define your timezone as IANA name (find your timezone here: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
//       	    Define your timezone offset from UTC (refer to UTC offset column - with/without daylight saving - in the link above)
// Stocks: 	  Replace Apple (AAPL) with the US stock ticker symbol of your choice
//			      Replace the xxxxxxx API key with your finnhub.io API Key (register free on https://finnhub.io)
// Weather:   Replace the LAT/LONG data below with your location
//			      Choose the temp unit: celsuis or fahrenheit
//			      Choose the wind speed unit: kmh or mph
// Themes:    Chose the desired Theme from the options below
//   		
// Use Monitor-Buddy:
// Setup Wifi on first boot by connecting to the Monitor-Buddy access point (AP)
// Press and hold the touch screen for 3 sec at any time later to redo the Wifi Setup (AP will start and you can configure your Monitor-Buddy
// Swipe left/right to move through the different pages
// Double Tap to disable and enable auto scrolling
// On the Face Page: single press the screen to switch to different faces
//
// Enjoy and have fun with Monitor-Buddy
//
// ============================================================

#include <Arduino.h>
#include <Arduino_GFX_Library.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_sntp.h>
#include <math.h>
#include <string.h>

#include <LittleFS.h>
#include <AyresWiFiManager.h>

// USER CONFIGURATION --------> EDIT BELOW

// Color Theme -- pick one:
//   0 = Classic   (white on black, the original look)
//   1 = Minimal   (white/gray with a single cyan accent on the key value)
//   2 = Semantic  (stock up=green/down=red, warm weather, gold sun & moon...)
//   3 = Warm amber (one gold/amber hue everywhere)
//   4 = Cool teal / blue
#define THEME 2

//Set your Github username to get Github statistics
#define GITHUB_USER   "IdefixRC"  // your GitHub username, for the stats page

// Adjust to your timezone
// UTC offset in hours — Examples: -5 = US Eastern, -8 = US Pacific, +1 = CET, +5.5 = IST, +8 = SGT
#define TIMEZONE        "Asia/Singapore"  // IANA name — used for weather URL only
#define TZ_OFFSET_HOURS 8               // UTC offset in hours (e.g. +8 = SGT, -5 = EST, +5.5 = IST)

// Stock Market Settings
// Quotes come from Finnhub (https://finnhub.io/api/v1/quote).
// You will need to create an account to get your own API Key.
#define TICKER            "AAPL"  // change to the desired stock ticker symbol (US Stocks only with free API)
// Your Finnhub API token lives in src/secrets.h, which is gitignored so the
// key never lands in version control. Copy src/secrets.h.example to
// src/secrets.h and paste your token there. Without it the stock page still
// builds but Finnhub rejects the request.
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef STOCKKEY
#define STOCKKEY "xxxxxxx"  // placeholder — create src/secrets.h with your token
#endif

// Weather Settings
// Define the lang/lat, Temperature Unit, Wind Speed Unit
#define LAT         "1.3119"    //define the latitude to be used for weather queries
#define LONG        "103.8149"  //define the longitude to be used for weather queries
#define TEMP        "celsius"   //define the temperature unit to be used - celsius/fahrenheit
#define WIND        "kmh"       //define the windspeed unit to be used for weather queries  - kmh/mph

// Page Settings
// Toggle each page on (true) or off (false). Disabled pages are skipped when
// swiping and auto-scrolling, and never fetch data. Leave at least one on — if
// all are off, the Face page is forced back on so the screen is never blank.
#define SHOW_FACE     true   // animated expressive face
#define SHOW_CLOCK    true   // digital clock
#define SHOW_DATE     true   // weekday / date
#define SHOW_WEATHER  true   // current weather (needs Wi-Fi)
#define SHOW_MOON     true   // moon phase
#define SHOW_STOCK    true   // stock ticker (needs Wi-Fi + Finnhub key)
#define SHOW_GITHUB   true   // GitHub follower/repo stats (needs Wi-Fi)


// OTHER CONFIGURATION ----> EDIT ONLY IF NECESSARY

// Access-point shown when the portal is open.
// AP_PASS must be 8-63 characters (WPA2 minimum) or the AP will
// refuse to start. Use "" only if you want an open AP.
#define AP_SSID   "Monitor-Buddy-Setup"
#define AP_PASS   "buddy1234"
#define AWM_HOSTNAME "Monitor-Buddy"

// How long the portal stays open with nobody using it, in seconds.
// The timer is reset by any connected AP client and by every HTTP
// request, so it will not close while you are actually using it.
#define PORTAL_TIMEOUT_S 300

// ── AWM GPIO assignment — DO NOT USE THE LIBRARY DEFAULTS ──
// AyresWiFiManager's constructor defaults are ledPin = 2 and
// buttonPin = 0. On this board GPIO2 is LCD_MOSI and GPIO1 is
// LCD_SCK: AWM's begin() calls pinMode(ledPin, OUTPUT) and
// digitalWrite(ledPin, LOW), which would clamp the SPI data line
// and blank the display. The pins below are passed explicitly to
// the constructor to avoid that.
//
// Pins already taken on the ESP32-C6-Touch-LCD-1.47:
//   1, 2, 14, 15, 22, 23  → LCD SPI / DC / CS / RST / backlight
//   18, 19, 20, 21        → touch I2C / RST / INT
//   5, 6                  → QMI8658 IMU interrupts
//   8                     → boot-mode strapping + onboard RGB LED
//   9                     → BOOT button
//   12, 13                → USB-Serial-JTAG
// GPIO3 is free, broken out, and is not a strapping pin, so it is
// used as a harmless "status LED" sink. Nothing is wired to it —
// AWM just toggles it. If you solder an LED to another free pin,
// change AWM_LED_PIN to match.
#define AWM_LED_PIN     3   // dummy/optional status LED — must NOT be an LCD or touch pin
#define AWM_BUTTON_PIN  9   // onboard BOOT button, active LOW

// Wi-Fi retry behaviour once we are running.
#define WIFI_RETRY_INTERVAL_MS  60000UL  // how often to attempt a reconnect
#define WIFI_RETRY_WINDOW_MS     2000UL  // how long each attempt may block the UI

// Hold the touchscreen this long to open the portal on demand.
#define TOUCH_PORTAL_HOLD_MS     2500UL

// Stock Market Refresh Settings
// !! API QUOTA HEADS-UP !!  Finnhub's free tier allows 60 API calls per minute.
// One call per minute is well within that, so this configuration will not hit
// the rate limit. Fetches only happen while the stock page is actually shown.
#define STOCK_REFRESH_MS  60000UL   // minimum ms between stock API calls (60 s)

// ── Pin definitions ────────────────────────────────────────
#define LCD_BL    23
#define LCD_DC    15
#define LCD_CS    14
#define LCD_SCK    1
#define LCD_MOSI   2
#define LCD_RST   22

#define TOUCH_SDA 18
#define TOUCH_SCL 19
#define TOUCH_RST 20
#define TOUCH_INT 21


struct AccelData {
  float accelX;
  float accelY;
  float accelZ;
  uint32_t timestamp;
};

struct GyroData {
  float gyroX;
  float gyroY;
  float gyroZ;
  uint32_t timestamp;
};

struct calData {
  bool valid;
  float accelBias[3];
  float gyroBias[3];
};

struct TouchPoint {
  uint16_t x;
  uint16_t y;
};

struct touch_data_t {
  uint8_t    count;
  TouchPoint coords[1];  // first active touch point used by this UI
};


// Forward declarations
static uint8_t currentClockHour();

void triggerDoubleTap();

void resetSharedI2CBus();
void bsp_touch_init(TwoWire *wire, uint8_t rstPin, uint8_t intPin, uint8_t rotation, uint16_t dispW, uint16_t dispH);
void bsp_touch_read();
uint16_t clampTouchCoord(int32_t value, uint16_t maxValue);
uint16_t scaleTouchAxis(uint16_t raw, uint16_t rawMin, uint16_t rawMax, uint16_t outMax);
bool bsp_touch_get_coordinates(uint16_t *outX, uint16_t *outY);
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b);
float clampFloat(float v, float lo, float hi);
void lcdRegInit();
uint32_t compileTimeSeconds();
uint8_t compileMonthNumber();
int32_t daysFromCivil(int32_t y, uint8_t mo, uint8_t d);
void civilFromDays(int32_t z, int32_t *year, uint8_t *month, uint8_t *day);
int32_t compileDateDays();
void centeredText(const char *text, int y, uint8_t size);
void drawPageDots();
void drawHeader(const char *title);
void switchApp(int8_t delta);
void buildPageList();
bool wifiConfigured();
bool githubConfigured();
bool ensureWifi();
void syncNTP();
void drawWeatherIcon(int cx, int cy, int code, bool isDay, uint16_t color);
bool fetchWeather();
bool fetchStock();
bool fetchGithub();
void drawFace(float tx, float ty);
void drawDigitSegment(int x, int y, int w, int h, int t, uint8_t seg, uint16_t color);
void drawDigit(int x, int y, uint8_t digit, int w, int h, int t, uint16_t color);
void drawClock();
void drawDatePage();
void drawWeather();
void drawMoonDisc(int cx, int cy, int radius, float phase, uint16_t color);
void drawMoon();
void drawStock();
void drawGithub();
void triggerFaceTap();
void readSensors();
void readTouch();
void updateFaceTimers();
void updateAutoPage();
void updateNetworkPages();
void calibrateNeutral();

// V2 additions
void drawBootMessage(const char *l1, const char *l2, const char *l3);
void drawPortalScreen();
void servicePortal();
void maintainWifi();
void openSetupPortal(const char *reason);

uint32_t lastI2CResetMs = 0;

void resetSharedI2CBus() {
  uint32_t now = millis();
  if (now - lastI2CResetMs < 250) return;
  lastI2CResetMs = now;
  Wire.end();
  delay(5);
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setClock(100000);
}

#define IMU_ADDRESS 0x6B

class QMI8658Mini {
 public:
  int init(calData cal, uint8_t address = IMU_ADDRESS) {
    imuAddress = address;
    calibration = cal;
    if (read8(0x00) != 0x05) return -1;  // WHO_AM_I
    write8(0x60, 0xFF);                  // soft reset
    delay(100);
    write8(0x02, 0x40);                  // CTRL1: auto-increment
    setAccelRange(4);
    setGyroRange(512);
    write8(0x06, 0x03);                  // CTRL5: accel/gyro low-pass defaults
    write8(0x08, 0x03);                  // CTRL7: enable accel + gyro
    delay(100);
    return 0;
  }

  int setAccelRange(int range) {
    uint8_t config = 0x10;
    if (range == 2) { accelScale = 2.0f / 32768.0f; config = 0x00; }
    else if (range == 4) { accelScale = 4.0f / 32768.0f; config = 0x10; }
    else if (range == 8) { accelScale = 8.0f / 32768.0f; config = 0x20; }
    else if (range == 16) { accelScale = 16.0f / 32768.0f; config = 0x30; }
    else return -1;
    write8(0x08, 0x00);
    rmw8(0x03, 0x70, config);            // CTRL2 accel range bits
    write8(0x08, 0x03);
    return 0;
  }

  int setGyroRange(int range) {
    uint8_t config = 0x50;
    if (range == 128 || range == 125) { gyroScale = 128.0f / 32768.0f; config = 0x30; }
    else if (range == 256 || range == 250) { gyroScale = 256.0f / 32768.0f; config = 0x40; }
    else if (range == 512 || range == 500) { gyroScale = 512.0f / 32768.0f; config = 0x50; }
    else if (range == 1024 || range == 1000) { gyroScale = 1024.0f / 32768.0f; config = 0x60; }
    else if (range == 2048 || range == 2000) { gyroScale = 2048.0f / 32768.0f; config = 0x70; }
    else return -1;
    write8(0x08, 0x00);
    rmw8(0x04, 0x70, config);            // CTRL3 gyro range bits
    write8(0x08, 0x03);
    return 0;
  }

  void update() {
    uint8_t status = read8(0x2E);        // STATUS0: accel/gyro ready bits
    if ((status & 0x03) == 0) return;
    uint8_t raw[12] = {0};
    if (!readBytes(0x35, raw, sizeof(raw))) return;

    int16_t ax = (int16_t)((raw[1] << 8) | raw[0]);
    int16_t ay = (int16_t)((raw[3] << 8) | raw[2]);
    int16_t az = (int16_t)((raw[5] << 8) | raw[4]);
    int16_t gx = (int16_t)((raw[7] << 8) | raw[6]);
    int16_t gy = (int16_t)((raw[9] << 8) | raw[8]);
    int16_t gz = (int16_t)((raw[11] << 8) | raw[10]);
    uint32_t now = micros();

    accel.accelX = ax * accelScale - calibration.accelBias[0];
    accel.accelY = ay * accelScale - calibration.accelBias[1];
    accel.accelZ = az * accelScale - calibration.accelBias[2];
    accel.timestamp = now;
    gyro.gyroX = gx * gyroScale - calibration.gyroBias[0];
    gyro.gyroY = gy * gyroScale - calibration.gyroBias[1];
    gyro.gyroZ = gz * gyroScale - calibration.gyroBias[2];
    gyro.timestamp = now;
  }

  void getAccel(AccelData *out) { *out = accel; }
  void getGyro(GyroData *out) { *out = gyro; }

 private:
  uint8_t imuAddress = IMU_ADDRESS;
  float accelScale = 4.0f / 32768.0f;
  float gyroScale = 512.0f / 32768.0f;
  calData calibration = {0};
  AccelData accel = {0};
  GyroData gyro = {0};

  uint8_t read8(uint8_t reg) {
    uint8_t value = 0;
    readBytes(reg, &value, 1);
    return value;
  }

  bool readBytes(uint8_t reg, uint8_t *buffer, uint8_t len) {
    Wire.beginTransmission(imuAddress);
    Wire.write(reg);
    if (Wire.endTransmission(true) != 0) { resetSharedI2CBus(); return false; }
    delayMicroseconds(300);
    if (Wire.requestFrom((uint8_t)imuAddress, len, (uint8_t)true) != len) {
      resetSharedI2CBus();
      return false;
    }
    for (uint8_t i = 0; i < len; i++) buffer[i] = Wire.read();
    return true;
  }

  void write8(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(imuAddress);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
  }

  void rmw8(uint8_t reg, uint8_t mask, uint8_t value) {
    uint8_t current = read8(reg);
    write8(reg, (current & ~mask) | (value & mask));
  }
};

// ── AXS5106L inline touch reader ──────────────────────────
// The AXS5106L is the capacitive touch controller on the
// Waveshare ESP32-C6-Touch-LCD-1.47. ESP-IDF components exist,
// but this Arduino starter inlines a small polling reader so it
// does not need the ESP-IDF/LVGL touch stack.
// Protocol: I2C @ 400 kHz, 7-bit device address 0x63.
// Touch packets are read from register 0x01. The packet starts
// with gesture_id, touch_count, then point data. This sketch uses
// the first active point for tap/swipe navigation.

#define AXS5106L_ADDR 0x63
#define AXS5106L_TOUCH_DATA_REG 0x01

static TwoWire *_touchWire = nullptr;
static uint8_t  _touchRst  = 255;
static uint8_t  _touchInt  = 255;
static uint16_t _touchW    = 320;
static uint16_t _touchH    = 172;
static uint8_t  _touchRot  = 0;

void bsp_touch_init(TwoWire *wire, uint8_t rstPin, uint8_t intPin,
                    uint8_t rotation, uint16_t dispW, uint16_t dispH) {
  _touchWire = wire;
  _touchRst  = rstPin;
  _touchInt  = intPin;
  _touchRot  = rotation;
  _touchW    = dispW;
  _touchH    = dispH;

  if (_touchRst != 255) {
    pinMode(_touchRst, OUTPUT);
    digitalWrite(_touchRst, LOW);
    delay(20);
    digitalWrite(_touchRst, HIGH);
    delay(50);
  }
  if (_touchInt != 255) {
    pinMode(_touchInt, INPUT_PULLUP);
  }
}

// bsp_touch_read — no-op for polling mode; INT pin can be
// checked externally if needed.
void bsp_touch_read() {}

uint16_t clampTouchCoord(int32_t value, uint16_t maxValue) {
  if (value < 0) return 0;
  if (value >= maxValue) return maxValue - 1;
  return (uint16_t)value;
}

uint16_t scaleTouchAxis(uint16_t raw, uint16_t rawMin, uint16_t rawMax, uint16_t outMax) {
  if (rawMax <= rawMin || outMax == 0) return 0;
  if (raw <= rawMin) return 0;
  if (raw >= rawMax) return outMax - 1;
  return (uint32_t)(raw - rawMin) * (outMax - 1) / (rawMax - rawMin);
}

// Returns true if at least one touch point is active.
bool bsp_touch_get_coordinates(uint16_t *outX, uint16_t *outY) {
  if (!_touchWire || !outX || !outY) return false;

  // Read only the first 6-byte touch frame. The UI only uses one point, and
  // shorter reads are less flaky than asking this controller for the optional
  // second-point bytes on every frame.
  _touchWire->beginTransmission(AXS5106L_ADDR);
  _touchWire->write(AXS5106L_TOUCH_DATA_REG);
  if (_touchWire->endTransmission(true) != 0) { resetSharedI2CBus(); return false; }
  delayMicroseconds(300);

  uint8_t len = _touchWire->requestFrom((uint8_t)AXS5106L_ADDR, (uint8_t)6, (uint8_t)true);
  if (len < 6) { resetSharedI2CBus(); return false; }

  uint8_t buf[6];
  for (uint8_t i = 0; i < 6; i++) buf[i] = _touchWire->read();

  uint8_t nPoints = buf[1] & 0x0F;
  if (nPoints == 0 || nPoints > 2) return false;

  // First point begins at byte 2: x_hi/event, x_lo, y_hi/id, y_lo.
  uint16_t rawX = ((uint16_t)(buf[2] & 0x0F) << 8) | buf[3];
  uint16_t rawY = ((uint16_t)(buf[4] & 0x0F) << 8) | buf[5];
  if ((rawX == 0x0FFF && rawY == 0x0FFF) || rawX > 4090 || rawY > 4090) return false;

  // Small edge dead-zone compensation. The controller reports raw axes with a
  // few pixels of slack at the extremes; scaling them to the active screen area
  // makes edge swipes less sticky while preserving the current orientation.
  const uint16_t edge = 3;
  uint16_t mappedX = rawX;
  uint16_t mappedY = rawY;
  switch (_touchRot) {
    case 1:  // landscape, default for this board
      mappedX = scaleTouchAxis(rawY, edge, _touchW > edge ? _touchW - 1 - edge : _touchW - 1, _touchW);
      mappedY = scaleTouchAxis(rawX, edge, _touchH > edge ? _touchH - 1 - edge : _touchH - 1, _touchH);
      break;
    case 2:
      mappedX = _touchW - 1 - scaleTouchAxis(rawX, edge, _touchW > edge ? _touchW - 1 - edge : _touchW - 1, _touchW);
      mappedY = _touchH - 1 - scaleTouchAxis(rawY, edge, _touchH > edge ? _touchH - 1 - edge : _touchH - 1, _touchH);
      break;
    case 3:
      mappedX = _touchW - 1 - scaleTouchAxis(rawY, edge, _touchW > edge ? _touchW - 1 - edge : _touchW - 1, _touchW);
      mappedY = scaleTouchAxis(rawX, edge, _touchH > edge ? _touchH - 1 - edge : _touchH - 1, _touchH);
      break;
    default:  // 0 — portrait
      mappedX = scaleTouchAxis(rawX, edge, _touchW > edge ? _touchW - 1 - edge : _touchW - 1, _touchW);
      mappedY = scaleTouchAxis(rawY, edge, _touchH > edge ? _touchH - 1 - edge : _touchH - 1, _touchH);
      break;
  }
  *outX = clampTouchCoord(mappedX, _touchW);
  *outY = clampTouchCoord(mappedY, _touchH);
  return true;
}
// ── End AXS5106L driver ────────────────────────────────────

static const int SCREEN_W         = 320;
static const int SCREEN_H         = 172;
static const uint8_t APP_COUNT    = 7;   // total number of pages defined

// Page identifiers, in fixed display order. These index the render switch in
// loop(); which are actually shown is decided by the SHOW_* toggles above.
#define PAGE_FACE     0
#define PAGE_CLOCK    1
#define PAGE_DATE     2
#define PAGE_WEATHER  3
#define PAGE_MOON     4
#define PAGE_STOCK    5
#define PAGE_GITHUB   6

// -- Face expressions (ported from DESKBUDDY-1.0, Edison Science Corner) --
// 9 moods, cycled by single-tapping the face page. A fast spin of the board
// still snaps to SURPRISED (see readSensors).
#define MOOD_NORMAL      0
#define MOOD_HAPPY       1
#define MOOD_SURPRISED   2
#define MOOD_SLEEPY      3
#define MOOD_ANGRY       4
#define MOOD_SAD         5
#define MOOD_EXCITED     6
#define MOOD_LOVE        7
#define MOOD_SUSPICIOUS  8
static const uint8_t FACE_MOOD_COUNT = 9;
static const uint32_t PAGE_AUTO_INTERVAL_MS = 8000;
static const uint16_t FG = RGB565_WHITE;
static const uint16_t BG = RGB565_BLACK;
static const uint8_t ROTATION = 1;

Arduino_DataBus *bus     = new Arduino_HWSPI(LCD_DC, LCD_CS, LCD_SCK, LCD_MOSI);
Arduino_GFX    *display  = new Arduino_ST7789(bus, LCD_RST, 0, false, 172, 320, 34, 0, 34, 0);
Arduino_Canvas *gfx      = new Arduino_Canvas(SCREEN_W, SCREEN_H, display);

// ── Wi-Fi manager instance ────────────────────────────────
// Explicit pins — see the AWM GPIO note near the top. Never let
// this default-construct, or it will grab GPIO2 (LCD_MOSI).
AyresWiFiManager wifiManager(AWM_LED_PIN, AWM_BUTTON_PIN);

QMI8658Mini imu;
calData calib = {0};
AccelData accel;
GyroData gyro;

bool     imuReady        = false;
bool     touchReady      = false;
bool     autoPageEnabled  = true;
bool     touchWasDown    = false;
bool     ntpSynced       = false;
bool     weatherValid    = false;
bool     stockValid      = false;
bool     githubValid     = false;
bool     portalFilesOk   = false;   // /index.html present in LittleFS?
bool     touchPortalArmed = false;  // one-shot latch for touch-and-hold
bool     portalNeedsRelease = false; // ignore the finger that opened the portal
uint8_t  currentApp      = 0;   // ID of the page currently shown (PAGE_*)
uint8_t  pageOrder[APP_COUNT];  // enabled page IDs, built from SHOW_* at boot
uint8_t  pageCount       = 0;   // how many pages are enabled
uint8_t  currentPageIdx  = 0;   // index into pageOrder[] of the current page
uint8_t  faceMood        = 0;
uint16_t touchStartX     = 0;
uint16_t touchStartY     = 0;
uint16_t touchLastX      = 0;
uint16_t touchLastY      = 0;
uint32_t touchStartMs    = 0;
uint8_t  touchMissFrames  = 0;
bool     touchMoved       = false;
uint8_t  tapCount         = 0;
uint32_t lastTapMs        = 0;
uint32_t autoPageBannerUntil = 0;
uint32_t nextBlink       = 1400;
uint32_t blinkUntil      = 0;
uint32_t nextGlance      = 900;
uint32_t nextAutoPage    = PAGE_AUTO_INTERVAL_MS;
uint32_t lastSerialMs    = 0;
uint32_t clockStartMillis   = 0;
uint32_t clockStartSeconds  = 0;
int32_t  clockStartDays     = 0;   // days-from-civil at last clock seed (NTP or compile)
uint32_t weatherUpdatedAt   = 0;
uint32_t stockUpdatedAt     = 0;
uint32_t githubUpdatedAt    = 0;
uint32_t lastWifiRetryMs    = 0;
uint32_t lastNtpSyncMs      = 0;
float restAx    = 0.0f;
float restAy    = 0.0f;
float filteredAx = 0.0f;
float filteredAy = 0.0f;
float filteredGz = 0.0f;
float faceGlanceX  = 0.0f;
float faceGlanceY  = 0.0f;
float faceTargetX  = 0.0f;
float faceTargetY  = 0.0f;
float pressPulse   = 0.0f;
int   weatherTempF    = 0;
int   weatherHumidity = 0;
int   weatherWindMph  = 0;
int   weatherCode     = -1;
bool  weatherIsDay    = true;
String weatherLabel   = "WAITING";
float  stockPrice = 0.0f;
float  stockOpen  = 0.0f;
float  stockHigh  = 0.0f;
float  stockLow   = 0.0f;
String stockTime  = "";
int githubFollowers = 0;
int githubRepos     = 0;

// Themed colours, assigned once by applyTheme() from the THEME setting above.
uint16_t COL_TIME, COL_SEC, COL_DATE_WD, COL_DATE_BIG, COL_VALUE, COL_LABEL;
uint16_t COL_TEMP, COL_WICON, COL_WSUB, COL_MOON, COL_MOONLAB;
uint16_t COL_PRICE_UP, COL_PRICE_DOWN, COL_TICKER, COL_GHLOGO, COL_GHNUM;

// ── Helpers ────────────────────────────────────────────────

uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// Assign the themed colours from the THEME setting. Called once at boot.
// Everything defaults to classic white (FG) so THEME 0 reproduces the
// original look exactly; each theme below overrides the roles it colours.
void applyTheme() {
  uint16_t W = FG;
  COL_TIME=COL_SEC=COL_DATE_WD=COL_DATE_BIG=COL_VALUE=COL_LABEL=W;
  COL_TEMP=COL_WICON=COL_WSUB=W;  COL_MOON=W;  COL_MOONLAB=W;
  COL_PRICE_UP=COL_PRICE_DOWN=COL_TICKER=COL_GHLOGO=COL_GHNUM=W;
#if THEME == 1
  uint16_t CY=rgb(0,200,255), GRAY=rgb(120,130,140);
  COL_SEC=CY; COL_DATE_WD=CY; COL_TEMP=CY; COL_MOONLAB=CY;
  COL_PRICE_UP=COL_PRICE_DOWN=CY; COL_GHNUM=CY;
  COL_LABEL=GRAY; COL_WSUB=GRAY; COL_MOON=rgb(220,220,220);
#elif THEME == 2
  uint16_t GRAY=rgb(120,130,140);
  COL_SEC=rgb(255,180,40); COL_DATE_WD=rgb(255,180,40);
  COL_TEMP=rgb(255,140,60); COL_WICON=rgb(255,210,90); COL_WSUB=rgb(60,200,200);
  COL_MOON=rgb(255,210,90); COL_MOONLAB=rgb(0,200,255);
  COL_PRICE_UP=rgb(60,220,120); COL_PRICE_DOWN=rgb(255,80,90);
  COL_GHNUM=rgb(60,220,120); COL_LABEL=GRAY;
#elif THEME == 3
  uint16_t AM=rgb(255,180,40), GO=rgb(255,210,90), CR=rgb(245,225,190);
  COL_TIME=AM; COL_SEC=GO; COL_DATE_WD=AM; COL_DATE_BIG=CR;
  COL_VALUE=rgb(235,215,180); COL_LABEL=rgb(150,120,80);
  COL_TEMP=AM; COL_WICON=GO; COL_WSUB=rgb(180,150,110);
  COL_MOON=GO; COL_MOONLAB=AM;
  COL_PRICE_UP=COL_PRICE_DOWN=AM; COL_TICKER=CR; COL_GHLOGO=CR; COL_GHNUM=AM;
#elif THEME == 4
  uint16_t CY=rgb(0,200,255), BL=rgb(90,170,255), TE=rgb(60,200,200),
           SL=rgb(150,160,185), LG=rgb(205,220,235);
  COL_TIME=CY; COL_SEC=TE; COL_DATE_WD=BL; COL_DATE_BIG=LG;
  COL_VALUE=LG; COL_LABEL=SL;
  COL_TEMP=CY; COL_WICON=BL; COL_WSUB=TE;
  COL_MOON=rgb(210,225,245); COL_MOONLAB=CY;
  COL_PRICE_UP=COL_PRICE_DOWN=CY; COL_TICKER=LG; COL_GHLOGO=LG; COL_GHNUM=CY;
#endif
}

float clampFloat(float v, float lo, float hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── LCD init sequence for the AXS15231B panel ─────────────

void lcdRegInit() {
  static const uint8_t ops[] = {
      BEGIN_WRITE,
      WRITE_COMMAND_8, 0x11,
      END_WRITE,
      DELAY, 120,
      BEGIN_WRITE,
      WRITE_C8_D16, 0xDF, 0x98, 0x53,
      WRITE_C8_D8,  0xB2, 0x23,
      WRITE_COMMAND_8, 0xB7,
      WRITE_BYTES, 4, 0x00, 0x47, 0x00, 0x6F,
      WRITE_COMMAND_8, 0xBB,
      WRITE_BYTES, 6, 0x1C, 0x1A, 0x55, 0x73, 0x63, 0xF0,
      WRITE_C8_D16, 0xC0, 0x44, 0xA4,
      WRITE_C8_D8,  0xC1, 0x16,
      WRITE_COMMAND_8, 0xC3,
      WRITE_BYTES, 8, 0x7D, 0x07, 0x14, 0x06, 0xCF, 0x71, 0x72, 0x77,
      WRITE_COMMAND_8, 0xC4,
      WRITE_BYTES, 12, 0x00, 0x00, 0xA0, 0x79, 0x0B, 0x0A, 0x16, 0x79, 0x0B, 0x0A, 0x16, 0x82,
      WRITE_COMMAND_8, 0xC8,
      WRITE_BYTES, 32,
      0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28, 0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
      0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28, 0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
      WRITE_COMMAND_8, 0xD0,
      WRITE_BYTES, 5, 0x04, 0x06, 0x6B, 0x0F, 0x00,
      WRITE_C8_D16, 0xD7, 0x00, 0x30,
      WRITE_C8_D8,  0xE6, 0x14,
      WRITE_C8_D8,  0xDE, 0x01,
      WRITE_COMMAND_8, 0xB7,
      WRITE_BYTES, 5, 0x03, 0x13, 0xEF, 0x35, 0x35,
      WRITE_COMMAND_8, 0xC1,
      WRITE_BYTES, 3, 0x14, 0x15, 0xC0,
      WRITE_C8_D16, 0xC2, 0x06, 0x3A,
      WRITE_C8_D16, 0xC4, 0x72, 0x12,
      WRITE_C8_D8,  0xBE, 0x00,
      WRITE_C8_D8,  0xDE, 0x02,
      WRITE_COMMAND_8, 0xE5,
      WRITE_BYTES, 3, 0x00, 0x02, 0x00,
      WRITE_COMMAND_8, 0xE5,
      WRITE_BYTES, 3, 0x01, 0x02, 0x00,
      WRITE_C8_D8, 0xDE, 0x00,
      WRITE_C8_D8, 0x35, 0x00,
      WRITE_C8_D8, 0x3A, 0x05,
      WRITE_COMMAND_8, 0x2A,
      WRITE_BYTES, 4, 0x00, 0x22, 0x00, 0xCD,
      WRITE_COMMAND_8, 0x2B,
      WRITE_BYTES, 4, 0x00, 0x00, 0x01, 0x3F,
      WRITE_C8_D8, 0xDE, 0x02,
      WRITE_COMMAND_8, 0xE5,
      WRITE_BYTES, 3, 0x00, 0x02, 0x00,
      WRITE_C8_D8, 0xDE, 0x00,
      WRITE_C8_D8, 0x36, 0x00,
      WRITE_COMMAND_8, 0x21,
      END_WRITE,
      DELAY, 10,
      BEGIN_WRITE,
      WRITE_COMMAND_8, 0x29,
      END_WRITE};
  bus->batchOperation(ops, sizeof(ops));
}

// ── Compile-time clock seed ────────────────────────────────

uint32_t compileTimeSeconds() {
  const char *t = __TIME__;
  uint8_t hh = (t[0]-'0')*10 + (t[1]-'0');
  uint8_t mm = (t[3]-'0')*10 + (t[4]-'0');
  uint8_t ss = (t[6]-'0')*10 + (t[7]-'0');
  return (uint32_t)hh*3600UL + (uint32_t)mm*60UL + ss;
}

uint8_t compileMonthNumber() {
  const char *m = __DATE__;
  static const char names[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
  for (uint8_t i = 0; i < 12; i++)
    if (strncmp(m, names+i*3, 3) == 0) return i+1;
  return 1;
}

int32_t daysFromCivil(int32_t y, uint8_t mo, uint8_t d) {
  y -= mo <= 2;
  const int32_t era = (y >= 0 ? y : y-399)/400;
  const uint32_t yoe = (uint32_t)(y - era*400);
  const uint32_t doy = (153*(mo+(mo>2?-3:9))+2)/5 + d - 1;
  const uint32_t doe = yoe*365 + yoe/4 - yoe/100 + doy;
  return era*146097 + (int32_t)doe - 719468;
}

void civilFromDays(int32_t z, int32_t *year, uint8_t *month, uint8_t *day) {
  z += 719468;
  const int32_t era = (z >= 0 ? z : z-146096)/146097;
  const uint32_t doe = (uint32_t)(z - era*146097);
  const uint32_t yoe = (doe - doe/1460 + doe/36524 - doe/146096)/365;
  int32_t y = (int32_t)yoe + era*400;
  const uint32_t doy = doe - (365*yoe + yoe/4 - yoe/100);
  const uint32_t mp  = (5*doy+2)/153;
  const uint32_t d   = doy - (153*mp+2)/5 + 1;
  const uint32_t mo  = mp + (mp < 10 ? 3 : -9);
  y += mo <= 2;
  *year  = y;
  *month = (uint8_t)mo;
  *day   = (uint8_t)d;
}

int32_t compileDateDays() {
  const char *d = __DATE__;
  uint8_t day = (d[4]==' ' ? 0 : d[4]-'0')*10 + (d[5]-'0');
  int32_t y = (int32_t)(d[7]-'0')*1000 + (int32_t)(d[8]-'0')*100 +
              (int32_t)(d[9]-'0')*10   + (d[10]-'0');
  return daysFromCivil(y, compileMonthNumber(), day);
}

// ── Drawing primitives ────────────────────────────────────

void centeredText(const char *text, int y, uint8_t size) {
  gfx->setTextSize(size);
  gfx->setTextColor(FG);
  int width = (int)strlen(text)*6*size;
  gfx->setCursor((SCREEN_W-width)/2, y);
  gfx->print(text);
}

void centeredTextColor(const char *text, int y, uint8_t size, uint16_t color) {
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  int width = (int)strlen(text)*6*size;
  gfx->setCursor((SCREEN_W-width)/2, y);
  gfx->print(text);
}

void drawPageDots() {
  if (pageCount == 0) return;
  int startX = SCREEN_W/2 - ((pageCount-1)*16)/2;
  for (uint8_t i = 0; i < pageCount; i++) {
    if (i == currentPageIdx)
      gfx->fillCircle(startX+i*16, SCREEN_H-12, 3, FG);
    else
      gfx->drawCircle(startX+i*16, SCREEN_H-12, 2, rgb(90,90,90));
  }
}

void drawHeader(const char *title) {
  // Page headings and the divider line were removed by request. This now just
  // clears the page; the title argument is kept so callers stay unchanged.
  (void)title;
  gfx->fillScreen(BG);
}

// Simple three-line boot/status card, used while Wi-Fi is being set up.
// Center text, auto-shrinking the font only if needed so it fits the width.
void centeredFit(const char *text, int y, uint8_t maxSize) {
  uint8_t sz = maxSize;
  int len = (int)strlen(text);
  while (sz > 1 && len * 6 * sz > SCREEN_W - 12) sz--;
  centeredText(text, y, sz);
}

void drawBootMessage(const char *l1, const char *l2, const char *l3) {
  gfx->fillScreen(BG);
  if (l1) centeredFit(l1, 36, 4);   // headline, up to size 4
  if (l2) centeredFit(l2, 90, 3);   // up to size 3
  if (l3) centeredFit(l3, 128, 2);  // up to size 2
  gfx->flush();
}

// ── App navigation ────────────────────────────────────────

// Build the list of enabled pages (in fixed order) from the SHOW_* toggles.
// Falls back to the Face page if everything is switched off, so the screen is
// never left blank.
void buildPageList() {
  pageCount = 0;
  if (SHOW_FACE)    pageOrder[pageCount++] = PAGE_FACE;
  if (SHOW_CLOCK)   pageOrder[pageCount++] = PAGE_CLOCK;
  if (SHOW_DATE)    pageOrder[pageCount++] = PAGE_DATE;
  if (SHOW_WEATHER) pageOrder[pageCount++] = PAGE_WEATHER;
  if (SHOW_MOON)    pageOrder[pageCount++] = PAGE_MOON;
  if (SHOW_STOCK)   pageOrder[pageCount++] = PAGE_STOCK;
  if (SHOW_GITHUB)  pageOrder[pageCount++] = PAGE_GITHUB;
  if (pageCount == 0) pageOrder[pageCount++] = PAGE_FACE;  // never leave it empty
  if (currentPageIdx >= pageCount) currentPageIdx = 0;
  currentApp = pageOrder[currentPageIdx];
}

// Move to the next/previous ENABLED page (wraps around the enabled list).
void switchApp(int8_t delta) {
  if (pageCount == 0) return;
  currentPageIdx = (currentPageIdx + pageCount + delta) % pageCount;
  currentApp = pageOrder[currentPageIdx];
  pressPulse = 1.0f;
  nextAutoPage = millis() + PAGE_AUTO_INTERVAL_MS;
}

// ── Wi-Fi ─────────────────────────────────────────────────
// Credentials now come from AyresWiFiManager (LittleFS /wifi.json),
// entered through the captive portal. No compile-time SSID/password.

// True when the device has usable stored credentials.
// AWM's tieneCredenciales() checks that /wifi.json exists AND that a
// non-empty ssid+password were parsed from it at begin().
bool wifiConfigured() { return wifiManager.tieneCredenciales(); }
bool githubConfigured() { return strlen(GITHUB_USER) > 0; }

// Network fetches call this before doing anything. It is now a pure
// status check — AWM owns connecting and reconnecting. It also refuses
// to run while the captive portal is up, because during the portal the
// radio is in AP / AP_STA mode and outbound requests would just stall.
bool ensureWifi() {
  if (wifiManager.isPortalActive()) return false;
  return wifiManager.isConnected();
}

// Open the portal on demand and log why.
void openSetupPortal(const char *reason) {
  if (wifiManager.isPortalActive()) return;
  Serial.printf("Opening Wi-Fi setup portal (%s)\n", reason);
  wifiManager.openPortal();
  // Cancel any in-flight touch gesture so the portal screen starts clean.
  touchWasDown = false;
  touchMoved   = false;
  touchMissFrames = 0;
  touchPortalArmed = false;
  // The finger that triggered this is still on the glass — make the portal
  // screen wait for a release before it will accept a "hold to close".
  portalNeedsRelease = true;
}

// ── NTP time sync ─────────────────────────────────────────
// Uses configTime() with a plain numeric UTC offset (TZ_OFFSET_HOURS * 3600).
// This is the most reliable approach on all ESP32 variants — no POSIX TZ
// strings, no IANA name lookup, no setenv/tzset. The ESP32 applies the
// offset directly to the synced epoch before returning it via time()/localtime().
// DST is set to 0 (add 3600 if your region is currently on summer time).
//
// NOTE (V2): AyresWiFiManager also runs its own NTP sync on connect, but it
// calls configTime(0, 0, ...) — i.e. plain UTC. That is harmless here because
// this function runs afterwards and re-issues configTime() with the local
// offset, and because the on-screen clock is millis()-driven once seeded.
// The 6-hour resync below re-applies the local offset periodically so an AWM
// reconnect can never leave the displayed clock on UTC.

void syncNTP() {
  if (ntpSynced) return;
  if (!wifiManager.isConnected()) return;

  // Numeric offset: TZ_OFFSET_HOURS * 3600 seconds. DST = 0.
  configTime((long)TZ_OFFSET_HOURS * 3600L, 0, "pool.ntp.org", "time.cloudflare.com");

  // Wait up to 8 s for a valid epoch (reject year ≤ 2000 / tm_year ≤ 100).
  uint32_t deadline = millis() + 8000UL;
  struct tm ti;
  memset(&ti, 0, sizeof(ti));
  while (millis() < deadline) {
    if (getLocalTime(&ti, 0) && ti.tm_year > 100) break;
    delay(200);
  }
  if (ti.tm_year <= 100) {
    Serial.println("NTP: no response — using compile-time seed");
    return;
  }

  // Convert to seconds-of-day (0–86399) for the running clock, plus the civil
  // day number so the date page rolls over from the real NTP date rather than
  // the compile date.
  uint32_t sod = (uint32_t)ti.tm_hour * 3600UL
               + (uint32_t)ti.tm_min  * 60UL
               + (uint32_t)ti.tm_sec;
  clockStartMillis  = millis();
  clockStartSeconds = sod;
  clockStartDays    = daysFromCivil(ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday);
  ntpSynced   = true;
  lastNtpSyncMs = millis();
  Serial.printf("NTP synced: %02d:%02d:%02d (UTC%+d / %s)\n",
                ti.tm_hour, ti.tm_min, ti.tm_sec,
                TZ_OFFSET_HOURS, TIMEZONE);
}

// ── Weather fetch (Open-Meteo) ────────────────────────────

const char *weatherCodeText(int code) {
  if (code == 0)                             return "CLEAR";
  if (code == 1 || code == 2)               return "PARTLY CLOUDY";
  if (code == 3)                             return "CLOUDY";
  if (code == 45 || code == 48)             return "FOG";
  if ((code>=51&&code<=67)||(code>=80&&code<=82)) return "RAIN";
  if (code >= 71 && code <= 77)             return "SNOW";
  if (code >= 95)                            return "STORM";
  return "WEATHER";
}

void drawWeatherIcon(int cx, int cy, int code, bool isDay, uint16_t color) {
  if (code == 0) {
    gfx->drawCircle(cx, cy, 22, color);
    for (uint8_t i = 0; i < 8; i++) {
      float a = i*0.7854f;
      gfx->drawLine(cx+(int)(cos(a)*30), cy+(int)(sin(a)*30),
                    cx+(int)(cos(a)*40), cy+(int)(sin(a)*40), color);
    }
    if (!isDay) gfx->fillCircle(cx+11, cy-8, 18, BG);
    return;
  }
  gfx->fillCircle(cx-19, cy+5, 19, color);
  gfx->fillCircle(cx+2,  cy-6, 25, color);
  gfx->fillCircle(cx+27, cy+8, 17, color);
  gfx->fillRoundRect(cx-42, cy+8, 87, 25, 12, color);
  if ((code>=51&&code<=67)||(code>=80&&code<=82)) {
    for (int x=-25; x<=25; x+=17) {
      gfx->drawLine(cx+x, cy+45, cx+x-8, cy+62, color);
      gfx->drawLine(cx+x+1, cy+45, cx+x-7, cy+62, color);
    }
  } else if (code>=71 && code<=77) {
    for (int x=-24; x<=24; x+=24) {
      gfx->drawLine(cx+x-6, cy+53, cx+x+6, cy+53, color);
      gfx->drawLine(cx+x, cy+47, cx+x, cy+59, color);
      gfx->drawLine(cx+x-5, cy+48, cx+x+5, cy+58, color);
      gfx->drawLine(cx+x+5, cy+48, cx+x-5, cy+58, color);
    }
  }
}

bool fetchWeather() {
  if (!ensureWifi()) return false;
  HTTPClient http;
  http.setTimeout(6000);
  String tzEncoded = String(TIMEZONE);
  tzEncoded.replace("/", "%2F");
  String weatherUrl = String("http://api.open-meteo.com/v1/forecast?")
    + "latitude=" + LAT + "&longitude=" + LONG
    + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
    + "&temperature_unit=" + TEMP + "&wind_speed_unit=" + WIND
    + "&timezone=" + tzEncoded;
  if (!http.begin(weatherUrl))
    return false;
  if (http.GET() != HTTP_CODE_OK) { http.end(); return false; }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return false;
  weatherTempF     = (int)round(doc["current"]["temperature_2m"].as<float>());
  weatherHumidity  = doc["current"]["relative_humidity_2m"].as<int>();
  weatherWindMph   = (int)round(doc["current"]["wind_speed_10m"].as<float>());
  weatherCode      = doc["current"]["weather_code"].as<int>();
  weatherIsDay     = doc["current"]["is_day"].as<int>() != 0;
  weatherLabel     = weatherCodeText(weatherCode);
  weatherUpdatedAt = millis();
  weatherValid     = true;
  return true;
}

// ── Stock fetch (Finnhub JSON) ────────────────────────────────────
// Uses Finnhub's /quote endpoint, which returns a flat JSON object:
//   {"c":327.74,"d":1.15,"dp":0.3521,"h":329.6,"l":322.2204,
//    "o":323.13,"pc":326.59,"t":1784664000}
//   c  = current/last price   o  = open      h = high    l = low
//   d  = abs change           dp = % change  pc = prev close   t = epoch
// NOTE: STOCKKEY holds the Finnhub API token.

bool fetchStock() {
  if (!ensureWifi()) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(7000);
  if (!http.begin(client, "https://finnhub.io/api/v1/quote?symbol=" TICKER "&token=" STOCKKEY))
    return false;
  if (http.GET() != HTTP_CODE_OK) { http.end(); return false; }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return false;

  // "c" is the last price. Finnhub returns c=0 for an unknown symbol or an
  // empty/invalid response, so treat non-positive as a failed fetch.
  if (doc["c"].isNull()) return false;
  float last = doc["c"].as<float>();
  if (last <= 0.0f) return false;

  stockPrice = last;                                     // "c"  → price (was closeText)
  stockOpen  = doc["o"].as<float>();                     // "o"  → open
  stockHigh  = doc["h"].as<float>();                     // "h"  → high
  stockLow   = doc["l"].as<float>();                     // "l"  → low
  stockTime  = String(doc["dp"].as<float>(), 2) + "%";   // "dp" → percent change
  stockUpdatedAt = millis();
  stockValid = true;
  return true;
}

// ── GitHub fetch ──────────────────────────────────────────

bool fetchGithub() {
  if (!githubConfigured()) return false;
  if (!ensureWifi()) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(7000);
  String url = String("https://api.github.com/users/") + GITHUB_USER;
  if (!http.begin(client, url)) return false;
  http.addHeader("User-Agent", "ESP32-C6-Touch-LCD");
  if (http.GET() != HTTP_CODE_OK) { http.end(); return false; }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return false;
  githubFollowers  = doc["followers"].as<int>();
  githubRepos      = doc["public_repos"].as<int>();
  githubUpdatedAt  = millis();
  githubValid      = true;
  return true;
}

// -- Face rendering (DESKBUDDY-style expressive eyes) -------
// Ported and scaled up from DESKBUDDY-1.0 (Edison Science Corner):
//   https://github.com/EDISON-SCIENCE-CORNER/DESKBUDDY-1.0
// The original targets a 128x64 mono OLED; here everything is scaled
// ~2.5x for this 320x172 colour panel and driven by the same spring
// physics: springy eyes, laggy pupils, blink, saccades and breathing.
// IMU tilt is folded into the gaze so the eyes still follow the board.

// Emotion particle bitmaps (16x16, 1-bit), drawn scaled 2x.
static const unsigned char bmp_heart[] PROGMEM = {
  0x00,0x00,0x0c,0x60,0x1e,0xf0,0x3f,0xf8,0x7f,0xfc,0x7f,0xfc,0x7f,0xfc,0x3f,0xf8,
  0x1f,0xf0,0x0f,0xe0,0x07,0xc0,0x03,0x80,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00 };
static const unsigned char bmp_zzz[] PROGMEM = {
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3c,0x00,0x0c,0x00,0x18,0x00,0x30,0x00,0x7e,
  0x00,0x00,0x3c,0x00,0x0c,0x00,0x18,0x00,0x30,0x00,0x7c,0x00,0x00,0x00,0x00,0x00 };
static const unsigned char bmp_anger[] PROGMEM = {
  0x00,0x00,0x11,0x10,0x2a,0x90,0x44,0x40,0x80,0x20,0x80,0x20,0x44,0x40,0x2a,0x90,
  0x11,0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 };

// GitHub 'mark' logo, 56x56 1-bit (octicons mark-github, rasterised).
static const unsigned char bmp_github[] PROGMEM = {
  0x00,0x00,0x01,0xff,0x80,0x00,0x00,
  0x00,0x00,0x1f,0xff,0xf8,0x00,0x00,
  0x00,0x00,0xff,0xff,0xff,0x00,0x00,
  0x00,0x03,0xff,0xff,0xff,0xc0,0x00,
  0x00,0x07,0xff,0xff,0xff,0xe0,0x00,
  0x00,0x1f,0xff,0xff,0xff,0xf8,0x00,
  0x00,0x3f,0xff,0xff,0xff,0xfc,0x00,
  0x00,0x7f,0xff,0xff,0xff,0xfe,0x00,
  0x00,0xff,0xff,0xff,0xff,0xff,0x00,
  0x01,0xff,0xff,0xff,0xff,0xff,0x80,
  0x03,0xff,0xff,0xff,0xff,0xff,0xc0,
  0x07,0xff,0xff,0xff,0xff,0xff,0xe0,
  0x07,0xf8,0x3f,0xff,0xfc,0x1f,0xe0,
  0x0f,0xf8,0x0f,0xff,0xf8,0x1f,0xf0,
  0x1f,0xf8,0x00,0x00,0x00,0x0f,0xf8,
  0x1f,0xf8,0x00,0x00,0x00,0x0f,0xf8,
  0x3f,0xf8,0x00,0x00,0x00,0x0f,0xfc,
  0x3f,0xf8,0x00,0x00,0x00,0x1f,0xfc,
  0x3f,0xf8,0x00,0x00,0x00,0x1f,0xfc,
  0x7f,0xf8,0x00,0x00,0x00,0x1f,0xfe,
  0x7f,0xf0,0x00,0x00,0x00,0x0f,0xfe,
  0x7f,0xe0,0x00,0x00,0x00,0x07,0xfe,
  0x7f,0xe0,0x00,0x00,0x00,0x07,0xfe,
  0xff,0xe0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xc0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xe0,0x00,0x00,0x00,0x03,0xff,
  0xff,0xe0,0x00,0x00,0x00,0x07,0xff,
  0xff,0xe0,0x00,0x00,0x00,0x07,0xff,
  0x7f,0xe0,0x00,0x00,0x00,0x07,0xfe,
  0x7f,0xf0,0x00,0x00,0x00,0x0f,0xfe,
  0x7f,0xf8,0x00,0x00,0x00,0x1f,0xfe,
  0x7f,0xfc,0x00,0x00,0x00,0x1f,0xfe,
  0x3f,0xfe,0x00,0x00,0x00,0x7f,0xfc,
  0x3f,0xff,0x00,0x00,0x00,0xff,0xfc,
  0x3f,0x1f,0xe0,0x00,0x07,0xff,0xfc,
  0x1f,0x0f,0xfc,0x00,0x3f,0xff,0xf8,
  0x1f,0xc7,0xfc,0x00,0x3f,0xff,0xf8,
  0x0f,0xc7,0xfc,0x00,0x1f,0xff,0xf0,
  0x07,0xe3,0xf8,0x00,0x1f,0xff,0xe0,
  0x07,0xf0,0xf0,0x00,0x1f,0xff,0xe0,
  0x03,0xf0,0x00,0x00,0x1f,0xff,0xc0,
  0x01,0xf8,0x00,0x00,0x1f,0xff,0x80,
  0x00,0xfc,0x00,0x00,0x1f,0xff,0x00,
  0x00,0x7f,0xf8,0x00,0x1f,0xfe,0x00,
  0x00,0x3f,0xf8,0x00,0x1f,0xfc,0x00,
  0x00,0x1f,0xf8,0x00,0x1f,0xf8,0x00,
  0x00,0x07,0xf8,0x00,0x1f,0xe0,0x00,
  0x00,0x03,0xf8,0x00,0x1f,0xc0,0x00,
  0x00,0x00,0xf8,0x00,0x1f,0x00,0x00,
  0x00,0x00,0x10,0x00,0x08,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,
};
static const int GH_W = 56, GH_H = 56;


// Eye geometry on the 320x172 canvas (centres, not top-left).
static const float FACE_LEFT_CX  = 105.0f;
static const float FACE_RIGHT_CX = 215.0f;
static const float FACE_EYES_CY  = 80.0f;

// One eye: animated CENTRE (x,y) + size (w,h), plus a pupil that lags behind.
// Each quantity is a critically-ish damped spring toward its target.
struct Eye {
  float x, y, w, h;
  float targetX, targetY, targetW, targetH;
  float pupilX, pupilY, targetPupilX, targetPupilY;
  float velX = 0, velY = 0, velW = 0, velH = 0, pVelX = 0, pVelY = 0;
  float k  = 0.12f;   // eye spring
  float d  = 0.60f;   // eye damping (heavier feel)
  float pk = 0.08f;   // pupil spring (softer/laggier)
  float pd = 0.50f;   // pupil damping
  bool  blinking = false;
  unsigned long lastBlink = 0, nextBlinkTime = 0;

  void init(float _x, float _y, float _w, float _h) {
    x = targetX = _x; y = targetY = _y;
    w = targetW = _w; h = targetH = _h;
    pupilX = targetPupilX = 0; pupilY = targetPupilY = 0;
    nextBlinkTime = millis() + random(1000, 4000);
  }
  void update() {
    velX = (velX + (targetX - x) * k) * d;
    velY = (velY + (targetY - y) * k) * d;
    velW = (velW + (targetW - w) * k) * d;
    velH = (velH + (targetH - h) * k) * d;
    x += velX; y += velY; w += velW; h += velH;
    pVelX = (pVelX + (targetPupilX - pupilX) * pk) * pd;
    pVelY = (pVelY + (targetPupilY - pupilY) * pk) * pd;
    pupilX += pVelX; pupilY += pVelY;
  }
};

Eye leftEye, rightEye;
static unsigned long lastSaccade     = 0;
static unsigned long saccadeInterval = 3000;
static float gazeLX = 0.0f, gazeLY = 0.0f;   // current saccade gaze target
static float breathVal = 0.0f;

// Draw a 1-bit bitmap scaled by an integer factor (nearest neighbour).
void drawBitmapScaled(int x, int y, const uint8_t *bmp, int w, int h, int scale, uint16_t color) {
  int bytesPerRow = (w + 7) / 8;
  for (int row = 0; row < h; row++)
    for (int col = 0; col < w; col++) {
      uint8_t b = pgm_read_byte(bmp + row * bytesPerRow + (col >> 3));
      if (b & (0x80 >> (col & 7)))
        gfx->fillRect(x + col * scale, y + row * scale, scale, scale, color);
    }
}

// Black "eyelid" fills that carve each mood's expression into the sclera.
// Proportional to eye size so they scale with the mood shapes.
void drawEyelidMask(int ix, int iy, int iw, int ih, uint8_t mood, bool isLeft) {
  int slant = (int)(iw * 0.167f);
  int band  = (int)(ih * 0.44f);
  if (mood == MOOD_ANGRY) {                       // brows angled in
    for (int i = 0; i < band; i++)
      if (isLeft) gfx->drawLine(ix, iy + i,         ix + iw, iy - slant + i, BG);
      else        gfx->drawLine(ix, iy - slant + i, ix + iw, iy + i,         BG);
  } else if (mood == MOOD_SAD) {                  // brows angled out (inverse)
    for (int i = 0; i < band; i++)
      if (isLeft) gfx->drawLine(ix, iy - slant + i, ix + iw, iy + i,         BG);
      else        gfx->drawLine(ix, iy + i,         ix + iw, iy - slant + i, BG);
  } else if (mood == MOOD_SLEEPY) {               // heavy top lids
    gfx->fillRect(ix, iy, iw, ih / 2 + 5, BG);
  } else if (mood == MOOD_SUSPICIOUS) {           // one squint, one wide
    if (isLeft) gfx->fillRect(ix, iy, iw, ih / 2 - 5, BG);
    else        gfx->fillRect(ix, iy + ih - (int)(ih * 0.22f), iw, (int)(ih * 0.22f), BG);
  }
}

// Draw one eye: white sclera, laggy black pupil, glint, then the eyelid mask.
void drawEyeShape(Eye &e, bool isLeft) {
  int iw = (int)e.w, ih = (int)e.h;
  if (iw < 2 || ih < 2) return;
  int ix = (int)(e.x - e.w / 2.0f);
  int iy = (int)(e.y - e.h / 2.0f);

  int r  = (iw < 50) ? 6 : 16;
  // Angry = red eyes (hard-coded face colour, not affected by THEME).
  uint16_t sclera = (faceMood == MOOD_ANGRY) ? rgb(255, 80, 90) : FG;
  gfx->fillRoundRect(ix, iy, iw, ih, r, sclera);

  int cx = ix + iw / 2, cy = iy + ih / 2;
  int pw = (int)(iw / 2.2f), ph = (int)(ih / 2.2f);

  if (faceMood == MOOD_HAPPY) {
    // Bright, cheerful open eyes: normal pupil, twin glints, no eyelid mask.
    // Rosy blush cheeks are added in drawFace().
    int px = cx + (int)e.pupilX - pw / 2;
    int py = cy + (int)e.pupilY - ph / 2;
    if (px < ix) px = ix;
    if (px + pw > ix + iw) px = ix + iw - pw;
    if (py < iy) py = iy;
    if (py + ph > iy + ih) py = iy + ih - ph;
    gfx->fillRoundRect(px, py, pw, ph, r / 2, BG);
    gfx->fillCircle(px + pw - 10, py + 10, 5, FG);   // main glint
    gfx->fillCircle(px + 9, py + ph - 11, 3, FG);    // second glint
    return;
  }

  if (faceMood == MOOD_EXCITED) {
    // Wide, shiny eyes: an oversized pupil, twin gold glints, and a gold sparkle
    // (hard-coded face colour, not affected by THEME).
    uint16_t gold = rgb(255, 210, 60);
    pw = (int)(iw / 1.85f); ph = (int)(ih / 1.85f);
    int px = cx + (int)e.pupilX - pw / 2;
    int py = cy + (int)e.pupilY - ph / 2;
    if (px < ix) px = ix;
    if (px + pw > ix + iw) px = ix + iw - pw;
    if (py < iy) py = iy;
    if (py + ph > iy + ih) py = iy + ih - ph;
    gfx->fillRoundRect(px, py, pw, ph, r / 2, BG);
    gfx->fillCircle(px + pw - 10, py + 10, 5, gold);   // main glint (gold)
    gfx->fillCircle(px + 9, py + ph - 11, 3, gold);    // second glint (gold)
    int sx = isLeft ? (ix - 2) : (ix + iw + 2);      // sparkle on the outer side
    int sy = iy + 2;
    gfx->fillRect(sx - 7, sy - 1, 15, 3, gold);
    gfx->fillRect(sx - 1, sy - 7, 3, 15, gold);
    return;
  }

  if (faceMood == MOOD_LOVE) {
    // Heart-shaped pupil: reuse the 16x16 heart icon, drawn in BG on the sclera,
    // scaled to the pupil size and following the same gaze offset. Eyes stay fully
    // open (no eyelid mask for LOVE), so both hearts are always visible.
    int scale = pw / 6;
    if (scale < 2) scale = 2;
    if (scale > 4) scale = 4;
    int hw = 16 * scale, hh = 16 * scale;
    int hx = cx + (int)e.pupilX - hw / 2;
    int hy = cy + (int)e.pupilY - hh / 2;
    if (hx < ix) hx = ix;
    if (hx + hw > ix + iw) hx = ix + iw - hw;
    if (hy < iy) hy = iy;
    if (hy + hh > iy + ih) hy = iy + ih - hh;
    drawBitmapScaled(hx, hy, bmp_heart, 16, 16, scale, BG);
  } else {
    int px = cx + (int)e.pupilX - pw / 2;
    int py = cy + (int)e.pupilY - ph / 2;
    if (px < ix) px = ix;
    if (px + pw > ix + iw) px = ix + iw - pw;
    if (py < iy) py = iy;
    if (py + ph > iy + ih) py = iy + ih - ph;
    gfx->fillRoundRect(px, py, pw, ph, r / 2, BG);
    if (iw > 30 && ih > 30) gfx->fillCircle(px + pw - 10, py + 10, 5, FG);   // glint
  }

  drawEyelidMask(ix, iy, iw, ih, faceMood, isLeft);
}

// Advance springs, blink, saccades, breathing and the per-mood eye shapes.
// tiltX/tiltY are the IMU-derived tilt (-1..1) so the gaze tracks the board.
void updateFacePhysics(float tiltX, float tiltY) {
  unsigned long now = millis();
  breathVal = sin(now / 800.0f) * 3.5f;

  // Blink (both eyes together, off the left eye's timer).
  if (now > leftEye.nextBlinkTime) {
    leftEye.blinking = rightEye.blinking = true;
    leftEye.lastBlink = now;
    leftEye.nextBlinkTime = now + random(2000, 6000);
  }
  if (leftEye.blinking && now - leftEye.lastBlink > 120)
    leftEye.blinking = rightEye.blinking = false;

  // Saccade: occasionally jump the gaze to a new random direction.
  if (!leftEye.blinking && now - lastSaccade > saccadeInterval) {
    lastSaccade = now;
    saccadeInterval = random(500, 3000);
    int dir = random(0, 10);
    if      (dir < 4)  { gazeLX = 0;   gazeLY = 0;   }   // centre
    else if (dir == 4) { gazeLX = -15; gazeLY = -10; }   // TL
    else if (dir == 5) { gazeLX = 15;  gazeLY = -10; }   // TR
    else if (dir == 6) { gazeLX = -15; gazeLY = 10;  }   // BL
    else if (dir == 7) { gazeLX = 15;  gazeLY = 10;  }   // BR
    else if (dir == 8) { gazeLX = 20;  gazeLY = 0;   }   // R
    else               { gazeLX = -20; gazeLY = 0;   }   // L
  }

  // Gaze target = saccade offset + live IMU tilt, applied every frame.
  float pupX = gazeLX + tiltX * 20.0f;
  float pupY = gazeLY + tiltY * 12.0f;
  leftEye.targetPupilX  = rightEye.targetPupilX = pupX;
  leftEye.targetPupilY  = rightEye.targetPupilY = pupY;
  leftEye.targetX  = FACE_LEFT_CX  + gazeLX * 0.3f + tiltX * 8.0f;
  rightEye.targetX = FACE_RIGHT_CX + gazeLX * 0.3f + tiltX * 8.0f;
  leftEye.targetY  = rightEye.targetY = FACE_EYES_CY + gazeLY * 0.3f + tiltY * 6.0f;

  if (leftEye.blinking) {
    leftEye.targetH = rightEye.targetH = 4;                 // slam shut
  } else {
    switch (faceMood) {
      case MOOD_HAPPY:
        // Big open eyes + blush cheeks (drawn in drawEyeShape / drawFace).
        leftEye.targetW = rightEye.targetW = 92;
        leftEye.targetH = rightEye.targetH = 92;
        leftEye.targetPupilY  -= 6;   // gaze slightly up = cheerful
        rightEye.targetPupilY -= 6;   break;
      case MOOD_LOVE:
        // Wide-open, fully-visible round eyes (heart pupils drawn in drawEyeShape).
        leftEye.targetW = rightEye.targetW = 96;
        leftEye.targetH = rightEye.targetH = 96;  break;
      case MOOD_SURPRISED:
        leftEye.targetW = rightEye.targetW = 75;
        leftEye.targetH = rightEye.targetH = 112;
        leftEye.targetPupilX  += random(-3, 4);             // jitter
        rightEye.targetPupilX += random(-3, 4); break;
      case MOOD_SLEEPY:
        leftEye.targetW = rightEye.targetW = 95;
        leftEye.targetH = rightEye.targetH = 75;  break;
      case MOOD_ANGRY:
        leftEye.targetW = rightEye.targetW = 85;
        leftEye.targetH = rightEye.targetH = 80;  break;
      case MOOD_SAD:
        leftEye.targetW = rightEye.targetW = 85;
        leftEye.targetH = rightEye.targetH = 100; break;
      case MOOD_EXCITED:
        // Tall, wide-open shiny eyes (big pupil + twin glints + sparkle).
        leftEye.targetW = rightEye.targetW = 90;
        leftEye.targetH = rightEye.targetH = 106 + breathVal;
        leftEye.targetPupilY  += random(-2, 3);
        rightEye.targetPupilY += random(-2, 3); break;
      case MOOD_SUSPICIOUS:
        leftEye.targetW  = 90;  leftEye.targetH  = 50;      // squint
        rightEye.targetW = 90;  rightEye.targetH = 105;     // wide
        break;
      case MOOD_NORMAL:
      default:
        leftEye.targetW = rightEye.targetW = 90;
        leftEye.targetH = rightEye.targetH = 90 + breathVal; break;
    }
  }

  leftEye.update();
  rightEye.update();
}

void drawFace(float tx, float ty) {
  gfx->fillScreen(BG);
  updateFacePhysics(tx, ty);

  // Floating emotion particles (scaled 2x from DESKBUDDY's 16x16 icons).
  if (faceMood == MOOD_LOVE) {
    drawBitmapScaled(18,  8, bmp_heart, 16, 16, 2, FG);
    drawBitmapScaled(270, 8, bmp_heart, 16, 16, 2, FG);
  } else if (faceMood == MOOD_SLEEPY) {
    drawBitmapScaled(144, 6, bmp_zzz, 16, 16, 2, FG);   // centred between the eyes
  } else if (faceMood == MOOD_ANGRY) {
    drawBitmapScaled(144, 8, bmp_anger, 16, 16, 2, FG); // centred between the eyes
  }

  drawEyeShape(leftEye, true);
  drawEyeShape(rightEye, false);

  // HAPPY: soft rosy blush cheeks at the lower-outer corners of the eyes.
  if (faceMood == MOOD_HAPPY) {
    uint16_t blush = rgb(255, 120, 150);
    gfx->fillCircle(70,  126, 13, blush);
    gfx->fillCircle(250, 126, 13, blush);
  }

  // Small offline hint on the face page so the user knows setup is available.
  if (!wifiManager.isConnected()) {
    gfx->setTextSize(1);
    gfx->setTextColor(rgb(150,150,150));
    const char *msg = wifiConfigured() ? "WIFI OFFLINE" : "HOLD TO SET UP WIFI";
    int w = (int)strlen(msg)*6;
    gfx->setCursor((SCREEN_W-w)/2, 6);
    gfx->print(msg);
  }
  drawPageDots();
}

// ── 7-segment clock ───────────────────────────────────────

void drawDigitSegment(int x, int y, int w, int h, int t, uint8_t seg, uint16_t color) {
  int half = h/2, r = t/2;
  switch (seg) {
    case 0: gfx->fillRoundRect(x+t, y, w-2*t, t, r, color); break;
    case 1: gfx->fillRoundRect(x+w-t, y+t, t, half-t, r, color); break;
    case 2: gfx->fillRoundRect(x+w-t, y+half, t, half-t, r, color); break;
    case 3: gfx->fillRoundRect(x+t, y+h-t, w-2*t, t, r, color); break;
    case 4: gfx->fillRoundRect(x, y+half, t, half-t, r, color); break;
    case 5: gfx->fillRoundRect(x, y+t, t, half-t, r, color); break;
    case 6: gfx->fillRoundRect(x+t, y+half-t/2, w-2*t, t, r, color); break;
  }
}

void drawDigit(int x, int y, uint8_t digit, int w, int h, int t, uint16_t color) {
  static const uint8_t masks[10] = {
    0b00111111,0b00000110,0b01011011,0b01001111,0b01100110,
    0b01101101,0b01111101,0b00000111,0b01111111,0b01101111};
  for (uint8_t seg = 0; seg < 7; seg++)
    if (masks[digit%10] & (1<<seg)) drawDigitSegment(x, y, w, h, t, seg, color);
}

void drawClock() {
  uint32_t elapsed = (millis()-clockStartMillis)/1000UL;
  uint32_t sod     = (clockStartSeconds+elapsed)%86400UL;
  uint8_t hh = sod/3600UL, mm = (sod/60UL)%60UL, ss = sod%60UL;
  gfx->fillScreen(BG);
  const int W = 54, H = 100, T = 10, Y = 18;   // bigger 7-seg digits
  // HH:MM shifted left to make room for the seconds after the minutes.
  drawDigit(8,   Y, hh/10, W, H, T, COL_TIME);
  drawDigit(70,  Y, hh%10, W, H, T, COL_TIME);
  if ((ss%2)==0) {
    gfx->fillRoundRect(134, Y+28, 11, 11, 5, COL_TIME);
    gfx->fillRoundRect(134, Y+62, 11, 11, 5, COL_TIME);
  }
  drawDigit(154, Y, mm/10, W, H, T, COL_TIME);
  drawDigit(216, Y, mm%10, W, H, T, COL_TIME);
  // Seconds (same size 3) tucked in behind the minutes, bottom-aligned.
  char sbuf[4];
  snprintf(sbuf, sizeof(sbuf), "%02u", (unsigned)ss);
  gfx->setTextSize(3); gfx->setTextColor(COL_SEC);
  gfx->setCursor(278, Y + H - 24);
  gfx->print(sbuf);
  drawPageDots();
}

// ── Date page ─────────────────────────────────────────────

void drawDatePage() {
  static const char *wd[]  = {"SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"};
  static const char *mon[] = {"JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"};
  uint32_t elapsedSec = (millis()-clockStartMillis)/1000UL;
  int32_t days = clockStartDays + (int32_t)((clockStartSeconds+elapsedSec)/86400UL);
  int32_t year; uint8_t month, day;
  civilFromDays(days, &year, &month, &day);
  uint8_t weekday = (uint8_t)((days+4)%7);
  gfx->fillScreen(BG);
  centeredTextColor(wd[weekday], 14, 4, COL_DATE_WD);
  char line[24];
  snprintf(line, sizeof(line), "%s %02u", mon[month-1], day);
  centeredTextColor(line, 62, 6, COL_DATE_BIG);
  snprintf(line, sizeof(line), "%ld", (long)year);
  centeredTextColor(line, 126, 3, COL_VALUE);
  drawPageDots();
}

// ── Shared "network page needs Wi-Fi" panel ───────────────
// Replaces the old "NO WIFI CONFIG / EDIT CONFIG" message, which told
// the user to edit a #define that no longer exists.
bool drawWifiGate() {
  if (wifiManager.isPortalActive()) {
    centeredText("SETUP MODE", 40, 4);
    centeredText("JOIN WIFI", 92, 2);
    centeredText(AP_SSID, 118, 2);
    drawPageDots();
    return true;
  }
  if (!wifiConfigured()) {
    centeredText("WIFI SETUP", 40, 4);
    centeredText("HOLD SCREEN 3s", 92, 2);
    centeredText("TO CONFIGURE", 118, 2);
    drawPageDots();
    return true;
  }
  if (!wifiManager.isConnected()) {
    centeredText("CONNECTING", 40, 4);
    centeredText("HOLD SCREEN 3s", 92, 2);
    centeredText("FOR WIFI SETUP", 118, 2);
    drawPageDots();
    return true;
  }
  return false;
}

// ── Weather page ──────────────────────────────────────────

void drawWeather() {
  gfx->fillScreen(BG);
  if (drawWifiGate()) return;
  if (!weatherValid) { centeredText("UPDATING", 74, 3); drawPageDots(); return; }
  drawWeatherIcon(250, 66, weatherCode, weatherIsDay, COL_WICON);
  gfx->setTextSize(8); gfx->setTextColor(COL_TEMP);
  gfx->setCursor(14, 34); gfx->print(weatherTempF);
  gfx->setTextSize(3); gfx->print(String(TEMP).startsWith("f") ? "F" : "C");
  gfx->setTextSize(2); gfx->setTextColor(COL_WSUB);
  gfx->setCursor(14, 116); gfx->print(weatherLabel);
  gfx->setTextColor(COL_LABEL);
  gfx->setCursor(14,  140); gfx->print("H "); gfx->print(weatherHumidity); gfx->print("%");
  // Wind, right-aligned: same 14 px gap from the right edge as humidity has from the left.
  { String wu = String(WIND); wu.toUpperCase();
    String windStr = String("W ") + weatherWindMph + wu;
    int windW = (int)windStr.length() * 12;          // size-2 chars are 12 px wide
    gfx->setCursor(SCREEN_W - 14 - windW, 140);
    gfx->print(windStr); }
  drawPageDots();
}

// ── Moon phase page ───────────────────────────────────────

const char *moonPhaseLabel(float phase) {
  if (phase<0.03f||phase>0.97f) return "NEW MOON";
  if (phase<0.22f)              return "WAXING CRESCENT";
  if (phase<0.28f)              return "FIRST QUARTER";
  if (phase<0.47f)              return "WAXING GIBBOUS";
  if (phase<0.53f)              return "FULL MOON";
  if (phase<0.72f)              return "WANING GIBBOUS";
  if (phase<0.78f)              return "LAST QUARTER";
  return "WANING CRESCENT";
}

void drawMoonDisc(int cx, int cy, int radius, float phase, uint16_t color) {
  phase = phase - floor(phase);
  gfx->drawCircle(cx, cy, radius+3, rgb(72,72,72));
  gfx->fillCircle(cx, cy, radius, color);
  if (phase<0.03f||phase>0.97f) {
    gfx->fillCircle(cx, cy, radius-2, BG);
    gfx->drawCircle(cx, cy, radius, color);
    return;
  }
  if (phase>0.47f && phase<0.53f) return;
  int shadowX = (phase < 0.5f)
    ? cx - (int)(4.0f*radius*phase)
    : cx + (int)(2.0f*radius - 4.0f*radius*(phase-0.5f));
  gfx->fillCircle(shadowX, cy, radius, BG);
  gfx->drawCircle(cx, cy, radius, color);
}

void drawMoon() {
  const float syn = 29.53058867f;
  uint32_t elapsed = (millis()-clockStartMillis)/1000UL;
  float days = (float)clockStartDays + ((float)clockStartSeconds+(float)elapsed)/86400.0f;
  float age  = fmod(days-10962.7597f, syn);
  if (age < 0.0f) age += syn;
  float phase       = age/syn;
  int   illumination = (int)round((1.0f-cos(phase*6.2831853f))*50.0f);
  gfx->fillScreen(BG);
  drawMoonDisc(240, 74, 58, phase, COL_MOON);
  gfx->setTextSize(2); gfx->setTextColor(COL_MOONLAB);
  gfx->setCursor(10, 24);  gfx->print(moonPhaseLabel(phase));
  gfx->setTextColor(COL_VALUE);
  gfx->setCursor(10, 92);  gfx->print("AGE "); gfx->print(age, 1); gfx->print(" DAYS");
  gfx->setCursor(10, 120); gfx->print("LIGHT "); gfx->print(illumination); gfx->print("%");
  drawPageDots();
}

// ── Stock page ────────────────────────────────────────────

void drawStock() {
  gfx->fillScreen(BG);
  if (drawWifiGate()) return;
  if (!stockValid) { centeredText("UPDATING", 74, 3); drawPageDots(); return; }
  char pbuf[16];
  snprintf(pbuf, sizeof(pbuf), "$%.2f", stockPrice);
  uint16_t priceCol = (stockPrice >= stockOpen) ? COL_PRICE_UP : COL_PRICE_DOWN;
  centeredTextColor(pbuf, 26, 6, priceCol);      // big price (up=green/down=red in semantic)
  // Ticker symbol on the left. Size 4 (twice the Open/High/Low text) for
  // symbols up to 5 characters; 6+ characters shrink so the text still fits
  // the left column, which must end before the O/H/L block at x=150.
  int tlen  = (int)strlen(TICKER);
  int tsize = 4;
  while (tsize > 1 && tlen * 6 * tsize > 132) tsize--;   // ~132 px available
  gfx->setTextSize(tsize); gfx->setTextColor(COL_TICKER);
  gfx->setCursor(14, 124 - 4 * tsize);                   // keep it vertically centred
  gfx->print(TICKER);
  // Open / High / Low on the right side.
  gfx->setTextSize(2); gfx->setTextColor(COL_VALUE);
  gfx->setCursor(150, 92);  gfx->print("OPEN  "); gfx->print(stockOpen, 2);
  gfx->setCursor(150, 116); gfx->print("HIGH  "); gfx->print(stockHigh, 2);
  gfx->setCursor(150, 140); gfx->print("LOW   "); gfx->print(stockLow, 2);
  drawPageDots();
}

// ── GitHub page ───────────────────────────────────────────

void drawGithub() {
  gfx->fillScreen(BG);
  if (!githubConfigured()) {
    centeredText("SET GITHUB_USER", 60, 3);
    centeredText("EDIT SKETCH", 100, 2);
    drawPageDots(); return;
  }
  if (drawWifiGate()) return;
  if (!githubValid) { centeredText("UPDATING", 74, 3); drawPageDots(); return; }

  // GitHub logo on the left, filling the vertical space.
  const int scale = 2;                          // 56x56 bitmap -> 112 px on screen
  const int lh = GH_H * scale;
  drawBitmapScaled(14, (SCREEN_H - lh) / 2, bmp_github, GH_W, GH_H, scale, COL_GHLOGO);

  // Stats on the right: followers large, repos smaller beneath.
  const int rx = 150;
  gfx->setTextColor(COL_GHNUM);
  gfx->setTextSize(6);
  gfx->setCursor(rx, 22);  gfx->print(githubFollowers);
  gfx->setTextColor(COL_LABEL);
  gfx->setTextSize(2);
  gfx->setCursor(rx, 78);  gfx->print("FOLLOWERS");
  gfx->setTextColor(COL_VALUE);
  gfx->setTextSize(3);
  gfx->setCursor(rx, 110); gfx->print(githubRepos);
  gfx->setTextColor(COL_LABEL);
  gfx->setTextSize(1);
  gfx->setCursor(rx, 140); gfx->print("REPOS");
  drawPageDots();
}

// ── Captive-portal screen ─────────────────────────────────
// Shown full-screen while AWM's portal is running, so the user can read
// the AP name/password off the device itself.

void drawPortalScreen() {
  gfx->fillScreen(BG);
  gfx->drawLine(0, 24, SCREEN_W, 24, rgb(0,180,255));
  centeredTextColor("WIFI SETUP", 5, 2, rgb(0,180,255));

  // Blinking "portal is live" dot, mirrors AWM's BLINK_SLOW LED state.
  if ((millis() / 500) % 2 == 0) gfx->fillCircle(SCREEN_W-16, 12, 5, rgb(0,220,120));

  if (!portalFilesOk) {
    centeredTextColor("SETUP FILES", 34, 3, rgb(255,90,90));
    centeredTextColor("MISSING", 64, 3, rgb(255,90,90));
    centeredText("Upload index.html", 104, 2);
    centeredText("to LittleFS", 130, 2);
    return;
  }

  // 1) Wi-Fi network name (large) -- all centred
  centeredTextColor("1  JOIN THIS WIFI", 32, 1, rgb(150,160,175));
  centeredTextColor(AP_SSID, 44, 2, FG);

  // 2) password (large)
  centeredTextColor("PASSWORD", 68, 1, rgb(150,160,175));
  centeredTextColor(AP_PASS, 80, 2, FG);

  // 3) address to open (large)
  centeredTextColor("2  OPEN IN BROWSER", 104, 1, rgb(150,160,175));
  centeredTextColor("192.168.4.1", 116, 2, rgb(0,200,255));

  // status line
  char cbuf[32];
  uint8_t clients = WiFi.softAPgetStationNum();
  snprintf(cbuf, sizeof(cbuf), "CONNECTED CLIENTS: %u", (unsigned)clients);
  centeredTextColor(cbuf, 142, 1, clients ? rgb(0,220,120) : rgb(120,120,120));
  centeredTextColor("hold screen 3s to close", 158, 1, rgb(110,110,110));
}

// While the portal is up, this owns the main loop: AWM needs update()
// called as fast as possible to serve DNS + HTTP without timeouts.
void servicePortal() {
  wifiManager.update();

  // Touch-and-hold closes the portal again (escape hatch if it was
  // opened by accident, or the router came back).
  static uint32_t holdStart = 0;
  uint16_t tx = 0, ty = 0;
  bool touching = touchReady && bsp_touch_get_coordinates(&tx, &ty);

  // Wait for the user to lift the finger that opened the portal, otherwise
  // one long press would open and immediately close it again.
  if (portalNeedsRelease) {
    if (!touching) portalNeedsRelease = false;
    touching = false;
    holdStart = 0;
  }

  if (touching) {
    if (holdStart == 0) holdStart = millis();
    else if (millis() - holdStart > TOUCH_PORTAL_HOLD_MS) {
      holdStart = 0;
      Serial.println("Closing Wi-Fi setup portal (touch hold)");
      wifiManager.closePortal();
      // Try to get back on the network straight away.
      if (wifiConfigured()) wifiManager.forzarReconexion();
      return;
    }
  } else {
    holdStart = 0;
  }

  drawPortalScreen();
  gfx->flush();
  delay(8);   // keep HTTP responsive; do not use the 24 ms UI delay here
}

// ── Wi-Fi upkeep while running ────────────────────────────
// AWM's reintentarConexionSiNecesario() blocks for up to
// reconnectAttemptMs, so it is rate-limited and the attempt window is
// kept short (2 s) to avoid visibly freezing the animation.

void maintainWifi() {
  if (wifiManager.isPortalActive()) return;
  if (wifiManager.isConnected()) return;
  if (millis() - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiRetryMs = millis();
  if (!wifiConfigured()) return;          // nothing to reconnect to
  wifiManager.reintentarConexionSiNecesario();
}

// ── Interaction handlers ──────────────────────────────────

void triggerDoubleTap() {
  autoPageEnabled = !autoPageEnabled;
  autoPageBannerUntil = millis() + 1400;
  if (autoPageEnabled) nextAutoPage = millis() + PAGE_AUTO_INTERVAL_MS;
  Serial.printf("Auto-advance: %s\n", autoPageEnabled ? "ON" : "OFF");
}

void triggerFaceTap() {
  uint32_t now = millis();
  // Double-tap detection: two taps within 400 ms
  if (now - lastTapMs < 400UL) {
    tapCount++;
    if (tapCount >= 2) {
      tapCount = 0;
      lastTapMs = 0;
      triggerDoubleTap();
      return;
    }
  } else {
    tapCount = 1;
  }
  lastTapMs = now;
  // Single-tap behaviour
  if (currentApp == 0) {
    faceMood = (faceMood+1) % FACE_MOOD_COUNT;
    pressPulse = 1.0f;
  } else {
    switchApp(1);
  }
  nextAutoPage = millis() + PAGE_AUTO_INTERVAL_MS;
}

void readSensors() {
  if (!imuReady) {
    // Animate eyes sinusoidally when IMU is absent
    filteredAx = sin(millis()*0.0012f)*0.12f;
    filteredAy = cos(millis()*0.0010f)*0.12f;
    return;
  }
  imu.update();
  imu.getAccel(&accel);
  imu.getGyro(&gyro);
  filteredAx = filteredAx*0.88f + accel.accelX*0.12f;
  filteredAy = filteredAy*0.88f + accel.accelY*0.12f;
  filteredGz = filteredGz*0.82f + gyro.gyroZ*0.18f;
  // Fast spin → surprised face
  if (fabs(filteredGz) > 130.0f) { faceMood = 2; pressPulse = 1.0f; }
}

void readTouch() {
  if (!touchReady) return;
  //if (!touchWasDown && TOUCH_INT != 255 && digitalRead(TOUCH_INT) != LOW) return;
  uint16_t x = 0, y = 0;
  bsp_touch_read();
  if (bsp_touch_get_coordinates(&x, &y)) {
    uint32_t now = millis();
    touchLastX = x; touchLastY = y;
    touchMissFrames = 0;
    if (!touchWasDown) {
      touchStartX = x; touchStartY = y; touchStartMs = now;
      touchMoved = false;
      touchWasDown = true;
      touchPortalArmed = true;   // this press is eligible to open the portal
      return;
    }
    int16_t dx = (int16_t)x-(int16_t)touchStartX;
    int16_t dy = (int16_t)y-(int16_t)touchStartY;
    if (abs(dx) > 12 || abs(dy) > 12) touchMoved = true;

    // Touch-and-hold (still, ~2.5 s) → open the Wi-Fi setup portal.
    // Fires once per press; a swipe cancels it.
    if (touchPortalArmed && !touchMoved && (now - touchStartMs) > TOUCH_PORTAL_HOLD_MS) {
      touchPortalArmed = false;
      openSetupPortal("touch hold");
      return;
    }

    if (abs(dx) > 55 && abs(dx) > abs(dy)+18) {
      switchApp(dx < 0 ? 1 : -1);
      touchWasDown = false;
      touchMissFrames = 0;
      touchMoved = false;
      touchPortalArmed = false;
    }
  } else if (touchWasDown) {
    // The AXS5106L INT/read path can miss the odd frame. Require a few
    // consecutive misses before treating it as release, otherwise taps/swipes
    // get chopped up and feel flaky.
    if (++touchMissFrames < 3) return;
    uint32_t pressMs = millis() - touchStartMs;
    int16_t dx = (int16_t)touchLastX-(int16_t)touchStartX;
    int16_t dy = (int16_t)touchLastY-(int16_t)touchStartY;
    if (pressMs >= 35 && pressMs <= 650 && !touchMoved && abs(dx) < 35 && abs(dy) < 35) {
      triggerFaceTap();
    }
    touchWasDown = false;
    touchMissFrames = 0;
    touchMoved = false;
    touchPortalArmed = false;
  }
}

void updateFaceTimers() {
  uint32_t now = millis();
  if (now > nextBlink) {
    blinkUntil = now + (random(0,6)==0 ? 220 : 105);
    nextBlink  = now + 1000 + random(0, 2600);
  }
  if (now > nextGlance) {
    faceTargetX = (float)random(-8, 9);
    faceTargetY = (float)random(-4, 5);
    nextGlance  = now + 650 + random(0, 1500);
  }
  faceGlanceX = faceGlanceX*0.84f + faceTargetX*0.16f;
  faceGlanceY = faceGlanceY*0.84f + faceTargetY*0.16f;
  pressPulse *= 0.86f;
}

void updateAutoPage() {
  if (autoPageEnabled && millis() > nextAutoPage) switchApp(1);
}

// Returns the current clock hour (0-23) derived from the running clock.
static uint8_t currentClockHour() {
  uint32_t elapsed = (millis() - clockStartMillis) / 1000UL;
  uint32_t sod     = (clockStartSeconds + elapsed) % 86400UL;
  return (uint8_t)(sod / 3600UL);
}

void updateNetworkPages() {
  // Nothing to fetch without a live STA connection.
  if (!ensureWifi()) return;

  // Weather: refresh every 15 min while on the weather page.
  if (currentApp == 3 && (!weatherValid || millis() - weatherUpdatedAt > 15UL * 60UL * 1000UL))
    fetchWeather();

  // Stock: fetch once when first shown, then refresh at most once per minute
  // (STOCK_REFRESH_MS) while the page stays on screen. No market-hours gating.
  else if (currentApp == 5) {
    static uint32_t lastStockFetchMs  = 0;
    static bool     stockFetchedOnce  = false;
    bool shouldFetch = !stockFetchedOnce                               // first view ever
                    || (millis() - lastStockFetchMs >= STOCK_REFRESH_MS);
    if (shouldFetch) {
      if (fetchStock()) {
        lastStockFetchMs = millis();
        stockFetchedOnce = true;
        Serial.printf("Stock fetched — next in >= %lu s\n",
                      (unsigned long)(STOCK_REFRESH_MS / 1000UL));
      }
    }
  }

  // GitHub: refresh every 30 min while on the GitHub page.
  else if (currentApp == 6 && (!githubValid || millis() - githubUpdatedAt > 30UL * 60UL * 1000UL))
    fetchGithub();
}

void calibrateNeutral() {
  gfx->fillScreen(BG);
  centeredText("HOLD STILL", 76, 2);
  gfx->flush();
  delay(900);
  for (uint8_t i = 0; i < 100; i++) { imu.update(); delay(5); }
  float sumX=0.0f, sumY=0.0f;
  for (uint8_t i = 0; i < 140; i++) {
    imu.update(); imu.getAccel(&accel);
    sumX += accel.accelX; sumY += accel.accelY;
    delay(5);
  }
  restAx = sumX/140.0f; restAy = sumY/140.0f;
  filteredAx = restAx;  filteredAy = restAy;
}

// ── Arduino entry points ──────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(150);
  Serial.println("ESP32-C6 Monitor-Buddy starting");
  applyTheme();   // set themed colours from THEME

  if (!gfx->begin(40000000)) Serial.println("Display init failed — check wiring");
  lcdRegInit();
  display->setRotation(ROTATION);
  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
  gfx->fillScreen(BG);
  gfx->flush();

  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setClock(100000);
  bsp_touch_init(&Wire, TOUCH_RST, TOUCH_INT, ROTATION, gfx->width(), gfx->height());
  touchReady = true;
  Serial.println("Touch controller initialised");

  int err = imu.init(calib, IMU_ADDRESS);
  if (err == 0) {
    imuReady = (imu.setAccelRange(4)==0 && imu.setGyroRange(512)==0);
    if (imuReady) calibrateNeutral();
  }
  if (!imuReady) Serial.println("IMU unavailable — using animated fallback motion");

  randomSeed(micros());
  // Initialise the DESKBUDDY-style eyes, centred on the face page.
  leftEye.init(FACE_LEFT_CX,  FACE_EYES_CY, 90, 90);
  rightEye.init(FACE_RIGHT_CX, FACE_EYES_CY, 90, 90);

  // Build the enabled-page list from the SHOW_* toggles.
  buildPageList();
  // Seed the clock from compile time + TZ offset as a safe fallback.
  // syncNTP() will overwrite this with an accurate value once Wi-Fi is up.
  clockStartMillis  = millis();
  // compileTimeSeconds() reflects __TIME__ which is UTC on the Schematik
  // build server, so we apply TZ_OFFSET_HOURS to get the local fallback.
  // syncNTP() will immediately replace this with an accurate getLocalTime() value.
  clockStartSeconds = compileTimeSeconds() + (int32_t)(TZ_OFFSET_HOURS * 3600L);
  clockStartDays    = compileDateDays();
  nextBlink         = millis() + 1200;
  nextGlance        = millis() + 600;
  nextAutoPage      = millis() + PAGE_AUTO_INTERVAL_MS;

  // ── AyresWiFiManager setup ──────────────────────────────
  // Order matters: all setters first, then begin() (mounts LittleFS and
  // loads /wifi.json), then run() (connects, or applies the fallback).
  drawBootMessage("Monitor-Buddy", "starting up...", nullptr);

  wifiManager.setHostname(AWM_HOSTNAME);
  wifiManager.setAPCredentials(AP_SSID, AP_PASS);
  wifiManager.setCaptivePortal(true);            // DNS catch-all → auto-popup portal
  wifiManager.setPortalTimeout(PORTAL_TIMEOUT_S);
  wifiManager.setAPClientCheck(true);            // don't close while a phone is joined
  wifiManager.setWebClientCheck(true);           // every HTTP request resets the timer

  // ON_FAIL is the policy that matches "open the portal whenever the board
  // cannot get onto Wi-Fi". It covers BOTH cases:
  //   - no credentials stored yet  → connectToWiFi() returns false → portal
  //   - credentials stored but the AP is gone / password wrong → portal
  // (NO_CREDENTIALS_ONLY, the library default, would silently give up on a
  // bad password, which is exactly the situation we need the portal for.)
  wifiManager.setFallbackPolicy(AyresWiFiManager::FallbackPolicy::ON_FAIL);
  wifiManager.setAutoReconnect(true);
  wifiManager.enableButtonPortal(true);          // BOOT button 2–5 s opens portal
  wifiManager.setLedAuto(true);

  // Keep reconnect attempts short so they don't stall the animation.
  wifiManager.setReconnectAttemptMs(WIFI_RETRY_WINDOW_MS);
  wifiManager.setReconnectBackoffMs(WIFI_RETRY_INTERVAL_MS);

  // Note: deliberately NOT calling setProtectedJsons({"/wifi.json"}).
  // Whitelisting wifi.json would make the portal's "erase credentials"
  // button and the >=5 s button hold do nothing.

  wifiManager.begin();   // mounts LittleFS, loads stored credentials

  // Verify the portal's HTML is actually on the filesystem. Without it AWM
  // serves HTTP 500 and the user has no way to enter credentials.
  portalFilesOk = LittleFS.exists("/index.html");
  if (!portalFilesOk) {
    Serial.println("WARNING: /index.html not found in LittleFS.");
    Serial.println("         Upload the AyresWiFiManager data/ folder");
    Serial.println("         (Tools > ESP32 LittleFS Data Upload).");
    drawBootMessage("FILES MISSING", "upload index.html", "to LittleFS");
    delay(3000);
  }

  if (wifiManager.tieneCredenciales()) {
    drawBootMessage("CONNECTING", "to saved WiFi...", nullptr);
  } else {
    drawBootMessage("WIFI SETUP", "no saved network", "starting portal...");
  }

  // Blocks: up to 2 s button window, then up to 15 s connect attempt.
  // On failure it opens the captive portal per the ON_FAIL policy above.
  wifiManager.run();

  if (wifiManager.isConnected()) {
    Serial.printf("Wi-Fi connected. IP: %s  RSSI: %d\n",
                  WiFi.localIP().toString().c_str(), wifiManager.getSignalStrength());
    syncNTP();
  } else if (wifiManager.isPortalActive()) {
    Serial.println("Captive portal open — join " AP_SSID " and browse to 192.168.4.1");
  } else {
    Serial.println("Wi-Fi unavailable — running offline, hold the screen to configure");
  }
}

void loop() {
  // ── Captive-portal mode takes over the whole loop ───────
  // AWM must service DNS + HTTP promptly, and the network pages are
  // meaningless while the radio is in AP mode.
  if (wifiManager.isPortalActive()) {
    servicePortal();
    return;
  }

  // Normal operation. update() still runs so the LED state machine and
  // any late portal shutdown are handled.
  wifiManager.update();
  maintainWifi();

  readSensors();
  readTouch();

  // A touch-hold inside readTouch() may have just opened the portal.
  if (wifiManager.isPortalActive()) return;

  updateAutoPage();
  updateFaceTimers();

  // Retry NTP if Wi-Fi came up after boot, and resync every 6 h to
  // correct drift and to undo any UTC-only resync done by AWM.
  if (ntpSynced && millis() - lastNtpSyncMs > 6UL * 3600UL * 1000UL) ntpSynced = false;
  if (!ntpSynced) syncNTP();

  updateNetworkPages();

  float tx=0.0f, ty=0.0f;
  if (imuReady) {
    tx = clampFloat(-(filteredAy-restAy)*2.2f, -1.0f, 1.0f);
    ty = clampFloat( (filteredAx-restAx)*2.2f, -1.0f, 1.0f);
  } else {
    tx = sin(millis()*0.0014f)*0.25f;
    ty = cos(millis()*0.0011f)*0.16f;
  }

  switch (currentApp) {
    case 0: drawFace(tx, ty); break;
    case 1: drawClock();      break;
    case 2: drawDatePage();   break;
    case 3: drawWeather();    break;
    case 4: drawMoon();       break;
    case 5: drawStock();      break;
    default: drawGithub();    break;
  }
  // Auto-advance banner — shown briefly after double-tap
  if (millis() < autoPageBannerUntil) {
    const char *msg = autoPageEnabled ? "AUTO: ON" : "AUTO: OFF";
    uint16_t bannerColor = autoPageEnabled ? rgb(0,200,80) : rgb(200,60,60);
    gfx->setTextSize(1);
    gfx->setTextColor(bannerColor);
    int bw = (int)strlen(msg)*6;
    gfx->fillRoundRect((SCREEN_W-bw-12)/2, SCREEN_H/2-10, bw+12, 20, 4, BG);
    gfx->drawRoundRect((SCREEN_W-bw-12)/2, SCREEN_H/2-10, bw+12, 20, 4, bannerColor);
    gfx->setCursor((SCREEN_W-bw)/2, SCREEN_H/2-4);
    gfx->print(msg);
  }
  gfx->flush();

  if (millis()-lastSerialMs > 1200) {
    lastSerialMs = millis();
    Serial.print("app="); Serial.print(currentApp);
    Serial.print(" mood="); Serial.println(faceMood);
    Serial.print(" wifi="); Serial.println(wifiManager.isConnected() ? "up" : "down");
  }
  delay(24);
}