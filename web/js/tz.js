// Time zone rules. Pure: no DOM, no network.

// POSIX rule for an IANA zone name, from the bundled table; null if unknown.
export function ruleForZone(table, name) {
  return Object.hasOwn(table, name) ? table[name] : null;
}

// POSIX rule for a fixed UTC offset in hours, rounded to 15 minutes.
// Port of tzRuleFromOffset in lib/settings/settings.cpp (keep in sync):
// +8 -> "<+08>-8", -5 -> "<-05>5", 5.5 -> "<+0530>-5:30", 0 -> "UTC0".
// POSIX counts west of UTC as positive, so the number's sign is reversed.
// Null outside -12..+14 h or for anything that isn't a number.
export function ruleFromOffset(hours) {
  if (typeof hours !== "number" || !(hours >= -12 && hours <= 14)) return null;
  const q = hours * 4;
  // lroundf rounds half away from zero; Math.round rounds half up.
  const minutes = (q < 0 ? -Math.round(-q) : Math.round(q)) * 15;
  if (minutes === 0) return "UTC0";
  const sign = minutes > 0 ? "+" : "-";
  const posixSign = minutes > 0 ? "-" : "";
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60), m = a % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return m === 0
    ? `<${sign}${pad(h)}>${posixSign}${h}`
    : `<${sign}${pad(h)}${pad(m)}>${posixSign}${h}:${pad(m)}`;
}
