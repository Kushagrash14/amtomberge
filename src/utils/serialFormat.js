// ═══════════════════════════════════════════════════════════════════════════════
// serialFormat.js — Atomberg product serial number rules
// Drawing ref: "BARCODE STICKER" A3 / A140601 (Rev 02)
//
// Format (16 chars, fixed width):
//
//   1      A       23      FG0497     S        00001
//   │      │       │       │          │        │
//   │      │       │       │          │        └─ counter 00001–99999
//   │      │       │       │          └────────── plant: S = Sonipat, P = Pune
//   │      │       │       └───────────────────── FG code (6 chars)
//   │      │       └───────────────────────────── year, last 2 digits
//   │      └───────────────────────────────────── month code (Jan..Dec)
//   └──────────────────────────────────────────── date code (1..31)
//
// Date/month codes come from the table on the drawing: digits 1–9 for days 1–9,
// then a reduced alphabet that drops the look-alike letters (I, O, Q, V) and
// pushes B, G, S, Z to the end of the run.
// ═══════════════════════════════════════════════════════════════════════════════

// Day 1 → index 0 … day 31 → index 30
export const DATE_CODES = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "A", "C", "D", "E", "F", "H", "J", "K", "L", "M", "N", "P",
  "R", "T", "U", "W", "X", "Y", "B", "G", "S", "Z",
];

// Jan → index 0 … Dec → index 11
export const MONTH_CODES = ["A", "C", "D", "E", "F", "H", "J", "K", "L", "M", "N", "P"];

// Only two plants exist. Anything else is a bad scan.
export const PLANT_CODES = { S: "SONIPAT", P: "PUNE" };

export const SERIAL_LENGTH = 16;
export const COUNTER_LENGTH = 5;
export const FG_CODE_LENGTH = 6;

// ─── Code lookups ─────────────────────────────────────────────────────────────
export function dateCodeForDay(day) {
  return DATE_CODES[day - 1] || "";
}

export function monthCodeForMonth(month1to12) {
  return MONTH_CODES[month1to12 - 1] || "";
}

export function yearCodeForYear(year) {
  return String(year).slice(-2);
}

export function dayFromDateCode(code) {
  const i = DATE_CODES.indexOf(String(code).toUpperCase());
  return i === -1 ? null : i + 1;
}

export function monthFromMonthCode(code) {
  const i = MONTH_CODES.indexOf(String(code).toUpperCase());
  return i === -1 ? null : i + 1;
}

// ─── Date helpers (local time — never use new Date("YYYY-MM-DD"), that's UTC) ──
export function parseYMD(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || "").trim());
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

export function localTodayStr(d = new Date()) {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Expected leading codes for a production date.
 * Returns { dateCode, monthCode, yearCode, head } where head = "1A23".
 */
export function expectedCodesForDate(dateStr) {
  const ymd = parseYMD(dateStr) || parseYMD(localTodayStr());
  const dateCode = dateCodeForDay(ymd.day);
  const monthCode = monthCodeForMonth(ymd.month);
  const yearCode = yearCodeForYear(ymd.year);
  return { ...ymd, dateCode, monthCode, yearCode, head: dateCode + monthCode + yearCode };
}

/**
 * Full expected prefix for a production date + model + plant, e.g. "1A23FG0497S".
 * Counter is appended by the line, not by us.
 */
export function buildSerialPrefix(dateStr, fgCode, plant) {
  return expectedCodesForDate(dateStr).head + String(fgCode || "").toUpperCase() + String(plant || "").toUpperCase();
}

/** Build a complete serial — handy for demo/test scans. */
export function buildSerial(dateStr, fgCode, plant, counter) {
  return buildSerialPrefix(dateStr, fgCode, plant) + String(counter).padStart(COUNTER_LENGTH, "0");
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
/**
 * Split a serial into its segments and decode the date. Does not compare
 * against an expected model/date — use validateSerial for that.
 */
export function parseSerial(raw) {
  const serial = String(raw || "").trim().toUpperCase();

  if (serial.length !== SERIAL_LENGTH) {
    return {
      ok: false,
      serial,
      error: `Serial must be ${SERIAL_LENGTH} characters (got ${serial.length})`,
    };
  }

  const dateCode = serial[0];
  const monthCode = serial[1];
  const yearCode = serial.slice(2, 4);
  const fgCode = serial.slice(4, 4 + FG_CODE_LENGTH);
  const plant = serial[10];
  const counterStr = serial.slice(11);

  const day = dayFromDateCode(dateCode);
  const month = monthFromMonthCode(monthCode);

  if (day === null) return { ok: false, serial, error: `Unknown date code "${dateCode}"` };
  if (month === null) return { ok: false, serial, error: `Unknown month code "${monthCode}"` };
  if (!/^\d{2}$/.test(yearCode)) return { ok: false, serial, error: `Bad year code "${yearCode}"` };
  if (!PLANT_CODES[plant]) {
    return { ok: false, serial, error: `Unknown plant code "${plant}" — only S (Sonipat) or P (Pune)` };
  }
  if (!/^\d{5}$/.test(counterStr) || +counterStr < 1) {
    return { ok: false, serial, error: `Counter must be 00001–99999 (got "${counterStr}")` };
  }

  const year = 2000 + +yearCode;
  const dateValid = new Date(year, month - 1, day).getDate() === day; // catches 31 Feb etc.

  return {
    ok: true,
    serial,
    dateCode,
    monthCode,
    yearCode,
    fgCode,
    plant,
    plantName: PLANT_CODES[plant],
    counter: +counterStr,
    counterStr,
    day,
    month,
    year,
    dateValid,
    dateStr: dateValid
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : null,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────
/**
 * Validate a scanned serial against the active production context.
 *
 * @param {string} raw            scanned serial
 * @param {object} opts
 * @param {string} opts.productionDate  "YYYY-MM-DD" — today, or the back-dated
 *                                      production day the operator selected
 * @param {string} opts.model           expected FG code, e.g. "FG0494"
 *
 * Note: plant/location is NOT restricted here — both Sonipat (S) and Pune (P)
 * serials are accepted. parseSerial() already rejects any code outside
 * PLANT_CODES, so a bad scan still fails; we just don't further filter by
 * which of the two valid plants it came from, and we don't key any logic
 * off plantName — only the raw plant code matters, and it's accepted either
 * way.
 * @returns {{ok: boolean, error?: string, parsed?: object}}
 */
export function validateSerial(raw, { productionDate, model } = {}) {
  const parsed = parseSerial(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error, parsed };

  if (!parsed.dateValid) {
    return { ok: false, error: `Serial encodes an impossible date (${parsed.day}/${parsed.month}/${parsed.year})`, parsed };
  }

  if (model && parsed.fgCode !== String(model).toUpperCase()) {
    return { ok: false, error: `Model mismatch — expected ${model}, scanned ${parsed.fgCode}`, parsed };
  }

  const expected = expectedCodesForDate(productionDate);
  const head = parsed.dateCode + parsed.monthCode + parsed.yearCode;
  if (head !== expected.head) {
    return {
      ok: false,
      error: `Date code mismatch — production day ${productionDate} expects "${expected.head}…", scanned "${head}…" (${parsed.day}/${parsed.month}/${parsed.year})`,
      parsed,
    };
  }

  return { ok: true, parsed };
}

// ─── Segment accessors used by the packing screen ─────────────────────────────
export function extractPackModel(serial) {
  const s = String(serial || "").trim().toUpperCase();
  return s.length >= 10 ? s.slice(4, 10) : "";
}

export function extractSeqNum(serial) {
  const s = String(serial || "").trim();
  const tail = s.slice(-COUNTER_LENGTH);
  return /^\d{5}$/.test(tail) ? parseInt(tail, 10) : 0;
}

export function extractPrefix(serial) {
  const s = String(serial || "").trim();
  return s.length > COUNTER_LENGTH ? s.slice(0, -COUNTER_LENGTH) : s;
}

export function extractPlant(serial) {
  const s = String(serial || "").trim().toUpperCase();
  return s.length >= 11 ? s[10] : "";
}