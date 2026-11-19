// Indian document rules, as pure code: GSTIN check digit, amounts in words, printed amounts.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const STATE_CODES: Record<string, string> = { KA: "29", KL: "32", TN: "33", MH: "27" };

// GSTIN = 2-digit state + 10-char PAN + entity no. + 'Z' + check character (mod-36 weighted checksum).
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(s: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s) && gstinCheckChar(s.slice(0, 14)) === s[14];
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) out.push(ONES[Math.floor(n / 100)], "Hundred");
  const r = n % 100;
  if (r >= 20) out.push(TENS[Math.floor(r / 10)], ...(r % 10 ? [ONES[r % 10]] : []));
  else if (r) out.push(ONES[r]);
  return out;
}

function wholeWords(n: number, indian: boolean): string[] {
  if (n === 0) return ["Zero"];
  const scales: [number, string][] = indian
    ? [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]]
    : [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
  const out: string[] = [];
  for (const [size, name] of scales) {
    const q = Math.floor(n / size);
    if (q) out.push(...wholeWords(q, indian), name);
    n %= size;
  }
  if (n) out.push(...below1000(n));
  return out;
}

export function amountInWords(minor: number, currency: "INR" | "USD"): string {
  const whole = Math.floor(minor / 100), frac = minor % 100;
  const [major, sub] = currency === "INR" ? ["Rupees", "Paise"] : ["US Dollars", "Cents"];
  const parts = [major, ...wholeWords(whole, currency === "INR")];
  if (frac) parts.push("and", ...wholeWords(frac, false), sub);
  return [...parts, "Only"].join(" ");
}

const VALUES: Record<string, number> = Object.fromEntries([
  ...ONES.map((w, i) => [w.toLowerCase(), i] as const).filter(([w]) => w),
  ...TENS.map((w, i) => [w.toLowerCase(), i * 10] as const).filter(([w]) => w),
  ["zero", 0],
]);
const MULT: Record<string, number> = { thousand: 1e3, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, million: 1e6, billion: 1e9 };

function parseWhole(words: string[]): number | null {
  let total = 0, cur = 0;
  for (const w of words) {
    if (w in VALUES) cur += VALUES[w];
    else if (w === "hundred") cur *= 100;
    else if (w in MULT) { total += cur * MULT[w]; cur = 0; }
    else return null;
  }
  return total + cur;
}

// "Rupees One Lakh Five and Fifty Paise Only" -> 10000550. Null if anything is unrecognised.
export function wordsToMinor(s: string): number | null {
  const words = s.toLowerCase().replace(/[-,]/g, " ").split(/\s+/).filter((w) => w && !["rupees", "rupee", "us", "dollars", "dollar", "only", "inr", "rs", "rs."].includes(w));
  const subIdx = words.findIndex((w) => w === "paise" || w === "cents");
  let major = words, minorWords: string[] = [];
  if (subIdx >= 0) {
    const and = words.lastIndexOf("and", subIdx);
    if (and < 0) return null;
    major = words.slice(0, and);
    minorWords = words.slice(and + 1, subIdx);
  }
  const whole = parseWhole(major.filter((w) => w !== "and"));
  const frac = minorWords.length ? parseWhole(minorWords) : 0;
  return whole === null || frac === null || frac > 99 ? null : whole * 100 + frac;
}

// "Rs. 1,23,456.78" | "-0.40" | "$1,234.00" -> signed minor units, or null.
export function parseAmount(s: string): number | null {
  const m = /^(-)?\s*(?:Rs\.?|INR|\$|USD)?\s*(\d[\d,]*)\.(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[2].replaceAll(",", "")) * 100 + Number(m[3]);
  return m[1] ? -v : v;
}

// Printing: "1,23,456.78" (Indian grouping) or "123,456.78". Display only.
export function printAmount(minor: number, currency: "INR" | "USD"): string {
  const sign = minor < 0 ? "-" : "", a = Math.abs(minor);
  return `${sign}${Math.floor(a / 100).toLocaleString(currency === "INR" ? "en-IN" : "en-US")}.${String(a % 100).padStart(2, "0")}`;
}
