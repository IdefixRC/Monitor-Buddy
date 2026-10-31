#include "schema.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace schema {

const char *const MSG_OBJECT = "must be an object";

bool Paths::has(const char *path) const {
  for (uint8_t i = 0; i < count; i++)
    if (strcmp(keys[i], path) == 0) return true;
  return false;
}

void Paths::add(const char *path) {
  if (count >= MAX || has(path)) return;
  strncpy(keys[count], path, LEN - 1);
  keys[count][LEN - 1] = '\0';
  count++;
}

namespace {

// "parent.name", or "name" at the top.
void join(char *out, const char *parent, const char *name) {
  if (parent[0]) snprintf(out, Paths::LEN, "%s.%s", parent, name);
  else snprintf(out, Paths::LEN, "%s", name);
}

void indexed(char *out, const char *parent, unsigned i) {
  snprintf(out, Paths::LEN, "%s[%u]", parent, i);
}

// A copy of the path as the key, so ArduinoJson copies it (char*, not const).
void put(JsonObject o, const char *path, const char *message) {
  char key[Paths::LEN];
  strncpy(key, path, sizeof key - 1);
  key[sizeof key - 1] = '\0';
  o[key] = message;
}

const Field *find(const Field *t, uint8_t n, const char *name) {
  for (uint8_t i = 0; i < n; i++)
    if (strcmp(t[i].name, name) == 0) return &t[i];
  return nullptr;
}

bool textOk(const Field &f, const char *s) {
  size_t n = strlen(s);
  if (n < (size_t)f.lo || n > (size_t)f.hi) return false;
  for (size_t i = 0; i < n; i++)
    if (strchr(f.chars, s[i]) == nullptr) return false;
  return f.check == nullptr || f.check(reinterpret_cast<const uint8_t *>(s));
}

bool coordOk(const Field &f, const char *s) {
  size_t n = strlen(s);
  if (n < 1 || n > (size_t)f.width - 1) return false;
  // Plain decimal only. strtod would also take leading whitespace, hex and
  // exponents, and the value goes verbatim into the weather URL.
  for (size_t i = 0; i < n; i++)
    if (strchr("0123456789.+-", s[i]) == nullptr) return false;
  char *end = nullptr;
  double d = strtod(s, &end);
  return end != s && *end == '\0' && d >= -f.hi && d <= f.hi;   // also rejects NaN
}

// Writes the value at base + f.offset only when it is valid.
bool applyScalar(const Field &f, JsonVariantConst v, uint8_t *base) {
  uint8_t *dst = base + f.offset;
  switch (f.kind) {
    case Kind::Bool:
      if (!v.is<bool>()) return false;
      *reinterpret_cast<bool *>(dst) = v.as<bool>();
      return true;
    case Kind::Int: {
      if (!v.is<int>()) return false;
      int x = v.as<int>();
      if (x < f.lo || x > f.hi) return false;
      if (f.width == 1) {
        *dst = (uint8_t)x;
      } else {
        int16_t y = (int16_t)x;
        memcpy(dst, &y, sizeof y);
      }
      return true;
    }
    case Kind::Choice: {
      if (!v.is<const char *>()) return false;
      const char *s = v.as<const char *>();
      for (uint8_t i = 0; i < f.wordCount; i++)
        if (strcmp(s, f.words[i]) == 0) { *dst = i; return true; }
      return false;
    }
    case Kind::Text: {
      if (!v.is<const char *>()) return false;
      const char *s = v.as<const char *>();
      if (!textOk(f, s)) return false;
      memcpy(dst, s, strlen(s) + 1);
      return true;
    }
    case Kind::Coord: {
      if (!v.is<const char *>()) return false;
      const char *s = v.as<const char *>();
      if (!coordOk(f, s)) return false;
      memcpy(dst, s, strlen(s) + 1);
      return true;
    }
    default:
      return false;
  }
}

void writeScalar(const Field &f, const uint8_t *base, JsonVariant out) {
  const uint8_t *src = base + f.offset;
  switch (f.kind) {
    case Kind::Bool:   out.set(*reinterpret_cast<const bool *>(src)); break;
    case Kind::Int:
      if (f.width == 1) {
        out.set((int)*src);
      } else {
        int16_t y;
        memcpy(&y, src, sizeof y);
        out.set((int)y);
      }
      break;
    case Kind::Choice: out.set(f.words[*src < f.wordCount ? *src : 0]); break;
    case Kind::Text:
    case Kind::Coord:  out.set(reinterpret_cast<const char *>(src)); break;
    default: break;
  }
}

bool isValueList(const Field &f) { return f.children[0].name == nullptr; }

// One list entry into `entry`. Errors under `path` ("coins[1]"). With
// `missing` (load), record fields absent from the entry set their bit.
bool readEntry(const Field &f, JsonVariantConst e, uint8_t *entry, const char *path,
               JsonObject errors, uint32_t *missing) {
  if (isValueList(f)) {
    if (applyScalar(f.children[0], e, entry)) return true;
    put(errors, path, f.children[0].error);
    return false;
  }
  JsonObjectConst o = e.as<JsonObjectConst>();
  if (o.isNull()) { put(errors, path, MSG_OBJECT); return false; }
  memcpy(entry, f.entryDefault, f.stride);
  bool ok = true;
  for (uint8_t c = 0; c < f.childCount; c++) {
    const Field &cf = f.children[c];
    JsonVariantConst cv = o[cf.name];
    if (cv.isNull()) { if (missing) *missing |= 1u << c; continue; }
    if (!applyScalar(cf, cv, entry)) {
      char p[Paths::LEN];
      join(p, path, cf.name);
      put(errors, p, cf.error);
      ok = false;
    }
  }
  return ok;
}

// Fills the list at base from `a`. False (with errors) when the count or any
// entry is invalid; the caller restores or discards.
bool readList(const Field &f, JsonVariantConst v, uint8_t *base, JsonObject errors,
              uint32_t *missing) {
  JsonArrayConst a = v.as<JsonArrayConst>();
  if (a.isNull() || a.size() < (size_t)f.lo || a.size() > (size_t)f.hi) {
    put(errors, f.name, f.error);
    return false;
  }
  bool ok = true;
  unsigned i = 0;
  for (JsonVariantConst e : a) {
    char p[Paths::LEN];
    indexed(p, f.name, i);
    if (!readEntry(f, e, base + f.offset + i * f.stride, p, errors, missing)) ok = false;
    i++;
  }
  base[f.countOffset] = (uint8_t)a.size();
  return ok;
}

void loadGroup(const Field &f, JsonVariantConst v, uint8_t *base, const uint8_t *defBase,
               Paths &added, JsonObject invalid) {
  JsonObjectConst o = v.as<JsonObjectConst>();
  if (o.isNull()) { put(invalid, f.name, MSG_OBJECT); return; }
  uint8_t *g = base + f.offset;
  for (uint8_t c = 0; c < f.childCount; c++) {
    const Field &cf = f.children[c];
    char p[Paths::LEN];
    join(p, f.name, cf.name);
    JsonVariantConst cv = o[cf.name];
    if (cv.isNull()) { added.add(p); continue; }
    if (!applyScalar(cf, cv, g)) put(invalid, p, cf.error);
  }
  // Checked even after a bad field: a kept default plus a stored value can
  // still break the rule, so the whole group goes back to its default.
  if (f.check && !f.check(g)) {
    memcpy(g, defBase + f.offset, f.stride);
    put(invalid, f.name, f.error);
  }
}

void loadList(const Field &f, JsonVariantConst v, uint8_t *base, const uint8_t *defBase,
              Paths &added, JsonObject invalid) {
  uint32_t missing = 0;
  if (!readList(f, v, base, invalid, &missing)) {
    memcpy(base + f.offset, defBase + f.offset, (size_t)f.stride * f.hi);
    base[f.countOffset] = defBase[f.countOffset];
    return;
  }
  for (uint8_t c = 0; c < f.childCount; c++) {
    if (!(missing & (1u << c))) continue;
    char p[Paths::LEN];
    join(p, f.name, f.children[c].name);
    added.add(p);
  }
}

bool mergeGroup(const Field &f, JsonVariantConst v, uint8_t *base, JsonObject errors) {
  JsonObjectConst o = v.as<JsonObjectConst>();
  if (o.isNull()) { put(errors, f.name, MSG_OBJECT); return false; }
  uint8_t *g = base + f.offset;
  bool ok = true;
  for (uint8_t c = 0; c < f.childCount; c++) {
    const Field &cf = f.children[c];
    JsonVariantConst cv = o[cf.name];
    if (cv.isNull()) continue;                    // missing or null: unchanged
    if (!applyScalar(cf, cv, g)) {
      char p[Paths::LEN];
      join(p, f.name, cf.name);
      put(errors, p, cf.error);
      ok = false;
    }
  }
  if (ok && f.check && !f.check(g)) { put(errors, f.name, f.error); ok = false; }
  return ok;
}

}  // namespace

void load(const Field *t, uint8_t n, const void *defaults, JsonVariantConst stored,
          void *out, size_t size, Paths &added, JsonObject invalid) {
  memcpy(out, defaults, size);
  added.count = 0;
  JsonObjectConst obj = stored.as<JsonObjectConst>();
  if (obj.isNull()) return;
  uint8_t *base = static_cast<uint8_t *>(out);
  const uint8_t *defBase = static_cast<const uint8_t *>(defaults);
  for (uint8_t i = 0; i < n; i++) {
    const Field &f = t[i];
    JsonVariantConst v = obj[f.name];
    if (v.isNull()) { added.add(f.name); continue; }
    if (f.kind == Kind::Group)     loadGroup(f, v, base, defBase, added, invalid);
    else if (f.kind == Kind::List) loadList(f, v, base, defBase, added, invalid);
    else if (!applyScalar(f, v, base)) put(invalid, f.name, f.error);
  }
}

bool merge(const Field *t, uint8_t n, const void *current, JsonVariantConst patch,
           void *out, size_t size, JsonObject errors) {
  memcpy(out, current, size);
  JsonObjectConst obj = patch.as<JsonObjectConst>();
  if (obj.isNull()) { errors["config"] = MSG_OBJECT; return false; }
  uint8_t *base = static_cast<uint8_t *>(out);
  bool ok = true;
  for (JsonPairConst kv : obj) {
    const Field *f = find(t, n, kv.key().c_str());
    if (!f) continue;                                     // unknown, or "v"
    if (f->kind == Kind::Group) {
      if (!mergeGroup(*f, kv.value(), base, errors)) ok = false;
    } else if (f->kind == Kind::List) {
      if (!readList(*f, kv.value(), base, errors, nullptr)) ok = false;
    } else if (!applyScalar(*f, kv.value(), base)) {
      put(errors, f->name, f->error);
      ok = false;
    }
  }
  return ok;
}

void toJson(const Field *t, uint8_t n, const void *s, JsonObject out) {
  const uint8_t *base = static_cast<const uint8_t *>(s);
  for (uint8_t i = 0; i < n; i++) {
    const Field &f = t[i];
    if (f.kind == Kind::Group) {
      JsonObject g = out[f.name].to<JsonObject>();
      for (uint8_t c = 0; c < f.childCount; c++)
        writeScalar(f.children[c], base + f.offset, g[f.children[c].name].to<JsonVariant>());
    } else if (f.kind == Kind::List) {
      JsonArray a = out[f.name].to<JsonArray>();
      for (uint8_t e = 0; e < base[f.countOffset]; e++) {
        const uint8_t *entry = base + f.offset + e * f.stride;
        if (isValueList(f)) {
          writeScalar(f.children[0], entry, a.add<JsonVariant>());
        } else {
          JsonObject o = a.add<JsonObject>();
          for (uint8_t c = 0; c < f.childCount; c++)
            writeScalar(f.children[c], entry, o[f.children[c].name].to<JsonVariant>());
        }
      }
    } else {
      writeScalar(f, base, out[f.name].to<JsonVariant>());
    }
  }
}

}  // namespace schema
