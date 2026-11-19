import { InvoiceSchema, type Invoice } from "@/schemas";
import { parseMoney } from "@/providers/llm";

export const CSV_HEADER = "invoice_number,supplier_id,date,currency,supplier_state,buyer_state,sku,hsn,qty,unit_price,gst_rate,surcharge,tax_total,grand_total";
const MAX_ROWS = 500;

// One row per line item; CONSECUTIVE rows sharing invoice_number+supplier_id form one invoice (a later repeat
// is a separate invoice, so duplicates stay detectable). All-or-nothing:
// any bad row => every error reported with its row number, nothing used.
export function parseInvoiceCsv(text: string): { ok: true; invoices: Invoice[] } | { ok: false; errors: string[] } {
  const rows = text.replace(/\r/g, "").split("\n").filter((r) => r.trim());
  if (!rows.length || rows[0].trim() !== CSV_HEADER) return { ok: false, errors: [`first row must be exactly: ${CSV_HEADER}`] };
  if (rows.length - 1 > MAX_ROWS) return { ok: false, errors: [`max ${MAX_ROWS} rows`] };
  const errors: string[] = [];
  const invoices: Invoice[] = [];
  let lastKey = "";
  rows.slice(1).forEach((row, i) => {
    const n = i + 2;
    const c = row.split(",").map((x) => x.trim());
    if (c.length !== 14) return errors.push(`row ${n}: expected 14 columns, got ${c.length}`);
    const [number, supplierId, date, currency, supplierState, buyerState, sku, hsn, qty, price, rate, surcharge, tax, grand] = c;
    const money = [price, surcharge || "0.00", tax, grand].map(parseMoney);
    if (money.some((x) => x === null)) return errors.push(`row ${n}: amounts must look like 1234.50`);
    if (!/^\d+$/.test(qty) || !/^\d+$/.test(rate)) return errors.push(`row ${n}: qty and gst_rate must be whole numbers`);
    const key = `${supplierId}|${number}`;
    if (key !== lastKey) invoices.push({
      id: `U-${invoices.length + 1}`, number, supplierId, supplierState, buyerState, poNumber: "-", date,
      currency: currency as "INR", lines: [], surcharges: [], taxTotal: money[2]!, grandTotal: money[3]!,
    });
    lastKey = key;
    const inv = invoices[invoices.length - 1];
    inv.lines.push({ sku, hsn, qty: Number(qty), unitPrice: money[0]!, gstRate: Number(rate) });
    if (money[1]) inv.surcharges.push({ label: "Surcharge", amount: money[1] });
  });
  invoices.forEach((inv) => {
    const p = InvoiceSchema.safeParse(inv);
    if (!p.success) errors.push(`invoice ${inv.number}: ${p.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, invoices };
}
