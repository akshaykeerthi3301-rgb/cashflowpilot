// The buyer's own records, as exported from their accounting system: vendor master, purchase orders, goods receipts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAmount } from "@/deterministic/gst";
import type { GRN, PO } from "@/schemas";

const DIR = path.join(process.cwd(), "data/prototype");
export const BATCHES = ["kaveri", "northbeam"] as const;
export type Batch = (typeof BATCHES)[number];
export type Vendor = { id: string; name: string; gstin: string; state: string; currency: "INR" | "USD" };

function csv(file: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path.join(DIR, "erp", file), "utf8").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
}

export const vendors = (): Vendor[] =>
  csv("vendors.csv").map((r) => ({ id: r.vendor_id, name: r.name, gstin: r.gstin, state: r.state, currency: r.currency as Vendor["currency"] }));

export function erp(batch: Batch): { pos: PO[]; grns: GRN[] } {
  const pos = new Map<string, PO>();
  for (const r of csv(`${batch}-purchase-orders.csv`)) {
    const po = pos.get(r.po_number) ?? { number: r.po_number, supplierId: r.vendor_id, lines: [] };
    po.lines.push({ sku: r.item_code, qty: Number(r.qty), unitPrice: parseAmount(r.rate)! });
    pos.set(r.po_number, po);
  }
  const grns = new Map<string, GRN>();
  for (const r of csv(`${batch}-goods-receipts.csv`)) {
    const g = grns.get(r.po_number) ?? { poNumber: r.po_number, lines: [] };
    g.lines.push({ sku: r.item_code, qtyReceived: Number(r.received_qty) });
    grns.set(r.po_number, g);
  }
  return { pos: [...pos.values()], grns: [...grns.values()] };
}

type Manifest = Record<Batch, { buyer: string; currency: "INR" | "USD"; docs: string[] }>;
export const manifest = (): Manifest => JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8"));

// Only ids listed in the manifest can be opened (no path tricks).
export function docBytes(batch: string, id: string): Uint8Array | null {
  const m = manifest();
  if (!(BATCHES as readonly string[]).includes(batch) || !m[batch as Batch].docs.includes(id)) return null;
  return readFileSync(path.join(DIR, "pdfs", batch, `${id}.pdf`));
}
