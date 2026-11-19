import type { Flag, GRN, Invoice, PO } from "@/schemas";
import { isValidGstin, wordsToMinor } from "./gst";

// Integer division rounded half-up. BigInt inside so paise x paise products never overflow.
export function roundDiv(n: number, d: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || n < 0 || d <= 0) throw new Error(`roundDiv needs non-negative integers, got ${n}/${d}`);
  const N = BigInt(n), D = BigInt(d);
  return Number((2n * N + D) / (2n * D));
}

// a * b / d rounded half-up, with the multiplication done in BigInt (crore x paise overflows a double).
export function mulDiv(a: number, b: number, d: number): number {
  if (![a, b, d].every(Number.isInteger) || a < 0 || b < 0 || d <= 0) throw new Error(`mulDiv needs non-negative integers`);
  const N = BigInt(a) * BigInt(b), D = BigInt(d);
  return Number((2n * N + D) / (2n * D));
}

// Illustrative GST rates by HSN/SAC code (post-2025 5%/18% slabs). Verify against the live schedule before real use.
export const EXPECTED_GST: Record<string, number> = {
  "8471": 18, // computers / IT hardware
  "8504": 18, // power supplies
  "3923": 18, // plastic packaging
  "9983": 18, // professional services (SAC)
  "0910": 5, // spices
  "6109": 5, // cotton apparel
  NA: 0, // cross-border USD invoices, no GST
};
export const PRICE_TOLERANCE_BP = 50; // 0.5%

// Intra-state: CGST + SGST, each half the rate, each rounded. Inter-state: IGST at the full rate.
export function lineTax(base: number, rate: number, intraState: boolean) {
  if (intraState) {
    const half = roundDiv(base * rate, 200);
    return { cgst: half, sgst: half, igst: 0, total: 2 * half };
  }
  const igst = roundDiv(base * rate, 100);
  return { cgst: 0, sgst: 0, igst, total: igst };
}

export type Finding = { invoiceId: string; flags: Flag[]; billed: number; expectedTotal: number; overbilled: number };

// poChecks=false: for uploads that come without POs/GRNs — only duplicate, GST and arithmetic checks run.
export function reconcile(batch: Invoice[], pos: PO[], grns: GRN[], { poChecks = true } = {}): Finding[] {
  const seen = new Set<string>();
  return batch.map((inv) => {
    const flags = new Set<Flag>();
    const intra = inv.supplierState === inv.buyerState;
    // Real documents declare their tax type; the arithmetic is checked against what was declared,
    // and the declaration itself against the place of supply.
    const declaredIntra = inv.taxType ? inv.taxType === "CGST_SGST" : intra;
    if (inv.taxType && inv.taxType !== (inv.currency === "USD" ? "NONE" : intra ? "CGST_SGST" : "IGST")) flags.add("WRONG_TAX_TYPE");
    if (inv.supplierGstin !== undefined && inv.currency === "INR" && !isValidGstin(inv.supplierGstin)) flags.add("INVALID_GSTIN");
    if (inv.amountInWords !== undefined && wordsToMinor(inv.amountInWords) !== inv.grandTotal) flags.add("WORDS_MISMATCH");
    const key = `${inv.supplierId}|${inv.number}`;
    const duplicate = seen.has(key);
    if (duplicate) flags.add("DUPLICATE_INVOICE");
    seen.add(key);

    const po = pos.find((p) => p.number === inv.poNumber && p.supplierId === inv.supplierId);
    const grn = grns.find((g) => g.poNumber === inv.poNumber);
    let subtotal = 0, computedTax = 0, expectedTotal = 0;

    for (const line of inv.lines) {
      const base = line.qty * line.unitPrice;
      subtotal += base;
      computedTax += lineTax(base, line.gstRate, declaredIntra).total;

      const poLine = po?.lines.find((l) => l.sku === line.sku);
      const expectedRate = EXPECTED_GST[line.hsn];
      if (expectedRate !== undefined && line.gstRate !== expectedRate) flags.add("GST_RATE_WRONG");
      if (!poChecks) {
        expectedTotal += base + lineTax(base, expectedRate ?? line.gstRate, intra).total;
        continue;
      }
      if (!poLine) {
        flags.add("UNAUTHORIZED_CHARGE");
        continue;
      }
      if (Math.abs(line.unitPrice - poLine.unitPrice) * 10000 > poLine.unitPrice * PRICE_TOLERANCE_BP) flags.add("PRICE_MISMATCH");
      const received = grn?.lines.find((l) => l.sku === line.sku)?.qtyReceived ?? 0;
      if (line.qty !== received) flags.add("QTY_MISMATCH");
      // What we should have been billed: PO price x received qty at the correct GST rate.
      const fairBase = Math.min(line.qty, received) * poLine.unitPrice;
      expectedTotal += fairBase + lineTax(fairBase, expectedRate ?? line.gstRate, intra).total;
    }

    const surcharge = inv.surcharges.reduce((s, x) => s + x.amount, 0);
    if (surcharge > 0 && poChecks) flags.add("UNAUTHORIZED_CHARGE"); // POs never carry surcharges
    if (computedTax !== inv.taxTotal) flags.add("TAX_MATH_ERROR");
    const roundOff = inv.roundOff ?? 0; // Indian invoices round the total to the rupee: at most ±50 paise
    if (subtotal + inv.taxTotal + surcharge + roundOff !== inv.grandTotal || Math.abs(roundOff) > 50) flags.add("TOTAL_MISMATCH");

    if (inv.roundOff !== undefined && inv.currency === "INR") expectedTotal = Math.floor((expectedTotal + 50) / 100) * 100;
    if (duplicate) expectedTotal = 0; // a duplicate should not be paid at all
    return { invoiceId: inv.id, flags: [...flags], billed: inv.grandTotal, expectedTotal, overbilled: Math.max(0, inv.grandTotal - expectedTotal) };
  });
}
