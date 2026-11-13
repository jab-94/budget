// Briques communes : montants (en CENTIMES entiers), dates, libellés.
// Portage fidèle de app/importers/base.py (version Python, testée).

export class ImportError extends Error {}

export function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error("date illisible");
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** « -1 234,56 € » -> -123456. Virgule ou point décimal, signe devant ou derrière. */
export function parseAmount(text) {
  if (text === null || text === undefined) throw new Error("montant vide");
  let s = String(text).trim().replace("€", "").replace("EUR", "").trim();
  if (!s) throw new Error("montant vide");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[\s  ']/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/,/g, ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("montant illisible");
  const [whole, dec = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number((dec + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** « 123.456789 » (point décimal, précision quelconque) -> centimes arrondis (demi vers le haut). */
export function parseDotDecimal(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^([-+]?)(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error("montant illisible");
  const neg = m[1] === "-";
  const dec = (m[3] || "") + "000";
  let cents = Number(m[2]) * 100 + Number(dec.slice(0, 2));
  if (Number(dec[2]) >= 5) cents += 1; // arrondi « demi vers le haut » en valeur absolue (comme Decimal ROUND_HALF_UP)
  return neg ? -cents : cents;
}

export function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  const e = Math.floor(a / 100), c = a % 100;
  return `${sign}${String(e).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${String(c).padStart(2, "0")} €`;
}

export function parseDate(text, defaultYear) {
  const s = String(text).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (m) return validDate(2000 + +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})$/);
  if (m && defaultYear) return validDate(defaultYear, +m[2], +m[1]);
  throw new Error("date illisible");
}

export const stripAccents = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "");

/** Majuscules sans accents, sans dates ni références : « CB Carrefour 02/03 » -> « CB CARREFOUR ». */
export function normalizeLabel(label) {
  let s = stripAccents(String(label)).toUpperCase();
  s = s.replace(/\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g, " ");
  s = s.replace(/\b[A-Z]*\d[\dA-Z]{5,}\b/g, " ");
  s = s.replace(/[^A-Z0-9 ]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Minuscules sans accents, MÊME LONGUEUR que l'entrée (indices conservés). */
export function plain(s) {
  let out = "";
  for (const c of s) {
    const base = stripAccents(c);
    out += (base ? base[0] : c).toLowerCase();
  }
  return out;
}

// --- Mois -----------------------------------------------------------------------------------
export function monthAdd(month, delta) {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export const isoToDate = (iso) => new Date(`${iso}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((isoToDate(b) - isoToDate(a)) / 86400000);
export function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Empreinte SHA-256 (hexadécimal), via le navigateur. */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
