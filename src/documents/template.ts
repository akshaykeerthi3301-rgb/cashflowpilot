// Deterministic reader for known invoice layouts (the way AP tools handle recurring suppliers).
// Works on the text layer only; returns values exactly as printed. Unknown layout => null.
import type { ExtractedDoc } from "@/schemas";

const COL: Record<string, keyof ExtractedDoc["lines"][number]> = {
  "Item Code": "sku", SKU: "sku", Code: "sku", "Item No.": "sku",
  Description: "description", Item: "description", Particulars: "description",
  HSN: "hsn", "HSN/SAC": "hsn", SAC: "hsn", Qty: "qty", Rate: "rate", "Unit Price": "rate",
  "GST %": "gstRate", "Tax %": "gstRate", GST: "gstRate", Amount: "amount", "Line Total": "amount", Value: "amount",
};
const SUBTOTAL = /^(Taxable Value|Sub Total|Total Taxable|Subtotal)\t/;
const AMT = "(-?[\\d,]+\\.\\d{2})";

export function readByTemplate(lines: string[]): ExtractedDoc | null {
  const all = lines.join("\n");
  const field = (re: RegExp) => re.exec(all)?.[1]?.trim() ?? "";
  const row = (label: string) => new RegExp(`^(?:${label})\\t${AMT}$`, "m").exec(all)?.[1] ?? "";

  const headerIdx = lines.findIndex((l) => l.split("\t").filter((c) => c in COL).length >= 4);
  const endIdx = lines.findIndex((l, i) => i > headerIdx && SUBTOTAL.test(l));
  if (headerIdx < 0 || endIdx < 0) return null;
  const header = lines[headerIdx].split("\t");
  const items = lines.slice(headerIdx + 1, endIdx).map((l) => {
    const cells = l.split("\t");
    const out = { sku: "", description: "", hsn: "", qty: "", rate: "", gstRate: "", amount: "" };
    header.forEach((h, i) => { if (COL[h] && cells[i] !== undefined) out[COL[h]] = cells[i]; });
    return out;
  });

  const usd = /\(USD\)|US Dollars/.test(all);
  const doc: ExtractedDoc = {
    invoiceNumber: field(/(?:Invoice No|Invoice #|Bill No\.|Invoice Number):\s*([^\t\n]+)/),
    invoiceDate: field(/(?:Invoice Date|Dated|Bill Date):\s*([^\t\n]+)/),
    poNumber: field(/(?:PO Ref|Purchase Order|Against PO|Customer PO):\s*([^\t\n]+)/),
    supplierName: lines[0]?.split("\t")[0] ?? "",
    supplierGstin: field(/(?:^|\t|\n)(?:GSTIN|Seller GSTIN|Our GSTIN):\s*([0-9A-Z]{15})/),
    buyerGstin: field(/(?:Buyer GSTIN|Customer GSTIN|Your GSTIN):\s*([0-9A-Z]{15})/),
    placeOfSupplyCode: field(/(?:Place of Supply|Supply To):[^\t\n]*\((\d{2})\)/) || field(/POS:\s*(\d{2})-/),
    currency: usd ? "USD" : "INR",
    lines: items,
    charges: [...all.matchAll(new RegExp(`^Add: ([^\\t]+)\\t${AMT}$`, "gm"))].map((m) => ({ label: m[1], amount: m[2] })),
    cgst: row("CGST"),
    sgst: row("SGST"),
    igst: row("IGST"),
    roundOff: row("Round Off|Rounding|R\\/O"),
    grandTotal: row("Grand Total|Total Payable|Net Amount|Total Due \\(USD\\)"),
    amountInWords: field(/(?:Amount in Words|In words|Amount Chargeable \(in words\)|Amount in words):\s*([^\t\n]+)/),
    confidence: 1,
  };
  const complete = doc.invoiceNumber && doc.grandTotal && doc.lines.length && doc.lines.every((l) => l.qty && l.rate && l.amount);
  return complete ? doc : null;
}
