import type { Invoice } from "@/schemas";

// Fill a text-only invoice with fields extracted by AI. Pure; extraction itself happens in providers/llm.
export function hydrate(inv: Invoice, extracted: Pick<Invoice, "lines" | "surcharges" | "taxTotal" | "grandTotal">): Invoice {
  return { ...inv, lines: extracted.lines, surcharges: extracted.surcharges, taxTotal: extracted.taxTotal, grandTotal: extracted.grandTotal };
}
