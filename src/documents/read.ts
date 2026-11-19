// The reading pipeline for one real invoice PDF:
//   text layer (code) -> AI or template reader (values as printed) -> grounding (code) -> conversion + checks (code).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { query } from "@/db";
import { STATE_CODES, parseAmount, wordsToMinor } from "@/deterministic/gst";
import { aiProvider, extractDocument, modelName } from "@/providers/llm";
import { ExtractedDocSchema, type ExtractedDoc, type Invoice } from "@/schemas";
import { MAX_PAGES, pageCount, pdfLines, scanImage } from "./pdf";
import { readByTemplate } from "./template";
import { vendors } from "./erp";

export type ReadBy = "template" | "ai-text" | "ai-vision" | "none";
export type ReadResult = {
  id: string;
  status: "read" | "review";
  readBy: ReadBy;
  model?: string;
  cached?: boolean;
  scan: boolean;
  reason?: string;
  note?: string; // e.g. AI was busy, so code read it instead
  fields?: ExtractedDoc;
  invoice?: Invoice;
  ms: number;
};

const STATE_BY_CODE = Object.fromEntries(Object.entries(STATE_CODES).map(([s, c]) => [c, s]));
const TAX_ROW = /^(add:\s*)?(c|s|i|u)?gst\b|round|^r\/o$|total|taxable|sub ?total|tax\b/i;
const norm = (s: string) => s.replace(/[,\s₹]|Rs\.?/g, "");

// Every value the reader returned must literally appear on the page. Catches invented numbers.
export function ungrounded(doc: ExtractedDoc, text: string): string[] {
  const page = norm(text);
  const values = [
    doc.invoiceNumber, doc.poNumber, doc.supplierGstin, doc.grandTotal, doc.cgst, doc.sgst, doc.igst,
    ...doc.lines.flatMap((l) => [l.qty, l.rate, l.amount]),
    ...doc.charges.map((c) => c.amount),
  ].filter(Boolean);
  return values.filter((v) => !page.includes(norm(v)));
}

// Printed strings -> an Invoice the engine can check. Returns a reason instead when the read is not usable.
export function toInvoice(id: string, d: ExtractedDoc): { invoice: Invoice } | { reason: string } {
  const amt = (s: string, label: string) => {
    const v = s ? parseAmount(s) : 0;
    if (v === null) throw new Error(`unreadable ${label} "${s}"`);
    return v;
  };
  try {
    if (!d.invoiceNumber || !d.grandTotal || !d.lines.length) return { reason: "invoice number, total or line items missing" };
    const lines = d.lines.map((l, i) => {
      const qty = Number(l.qty.replace(/,/g, ""));
      const unitPrice = amt(l.rate, `rate on line ${i + 1}`);
      const amount = amt(l.amount, `amount on line ${i + 1}`);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`unreadable quantity on line ${i + 1}`);
      // A line whose own arithmetic fails was almost certainly misread: don't guess, ask a person.
      if (qty * unitPrice !== amount) throw new Error(`line ${i + 1}: ${l.qty} × ${l.rate} ≠ ${l.amount}`);
      // Without an item code the line can't be matched to the purchase order: a person, not a false alarm.
      if (!l.sku.trim() && d.poNumber) throw new Error(`item code missing on line ${i + 1}`);
      // A missing HSN on an Indian invoice means "can't check the GST rate", not "no GST" ("?" has no expected rate).
      return { sku: l.sku, hsn: l.hsn || (d.currency === "USD" ? "NA" : "?"), description: l.description, qty, unitPrice, gstRate: Number(l.gstRate.replace(/\D/g, "") || 0) };
    });
    if (d.amountInWords && wordsToMinor(d.amountInWords) === null) return { reason: "amount in words could not be read" };
    const cgst = amt(d.cgst, "CGST"), sgst = amt(d.sgst, "SGST"), igst = amt(d.igst, "IGST");
    const vs = vendors();
    const v = vs.find((x) => x.gstin && d.supplierGstin && x.gstin.slice(0, 14) === d.supplierGstin.slice(0, 14))
      ?? vs.find((x) => x.name.toLowerCase() === d.supplierName.toLowerCase());
    const inr = d.currency === "INR";
    return {
      invoice: {
        id,
        number: d.invoiceNumber,
        date: d.invoiceDate,
        poNumber: d.poNumber || "-",
        supplierId: v?.id ?? `UNKNOWN:${d.supplierName}`,
        supplierName: d.supplierName,
        supplierState: v?.state ?? STATE_BY_CODE[d.supplierGstin.slice(0, 2)] ?? "??",
        buyerState: inr ? STATE_BY_CODE[d.placeOfSupplyCode] ?? "??" : "US",
        supplierGstin: inr ? d.supplierGstin : undefined,
        buyerGstin: d.buyerGstin || undefined,
        currency: d.currency,
        lines,
        // Tax, round-off and total rows have their own fields; a reader that also lists them as "charges" would
        // double-count them. Fixed rule, applied by code to every read (live, cached or shipped).
        surcharges: d.charges.filter((c) => !TAX_ROW.test(c.label)).map((c) => ({ label: c.label.replace(/^Add:\s*/i, ""), amount: amt(c.amount, c.label) })),
        taxType: igst ? "IGST" : cgst || sgst ? "CGST_SGST" : "NONE",
        taxTotal: cgst + sgst + igst,
        roundOff: inr ? amt(d.roundOff, "round off") : undefined,
        grandTotal: amt(d.grandTotal, "grand total"),
        amountInWords: d.amountInWords || undefined,
      },
    };
  } catch (e) {
    return { reason: (e as Error).message };
  }
}

// Real AI reads of the sample PDFs, produced by `npm run eval:ai` + `npm run export:ai-reads` and shipped with the
// app, so a sample batch shows Groq's actual output instantly instead of waiting on the free-plan rate limit.
let shipped: Record<string, { model: string; result: ExtractedDoc }> | null = null;
export const resetShippedReads = () => void (shipped = null);
function shippedRead(hash: string) {
  if (!shipped) {
    const file = process.env.AI_READS_FILE ?? "data/prototype/ai-reads.json"; // "" disables (tests of the code reader)
    try {
      shipped = file ? JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")) : {};
    } catch {
      shipped = {};
    }
  }
  const hit = shipped![hash];
  return hit && ExtractedDocSchema.safeParse(hit.result).success ? hit : undefined;
}

async function cachedAi(hash: string, input: { text?: string; imageB64?: string; pdfB64?: string }, ws: string, fallback: () => unknown, live: boolean) {
  const model = modelName(input);
  const ship = shippedRead(hash);
  if (ship && (!live || ship.model === model)) return { ok: true as const, data: ship.result, source: "model" as const, model: ship.model, cached: true };
  if (!live) return { ok: false as const, reason: "AI off", source: "mock" as const, cached: false };
  const [hit] = await query<{ result: ExtractedDoc }>("SELECT result FROM doc_cache WHERE hash=$1 AND model=$2", [hash, model]);
  if (hit) return { ok: true as const, data: hit.result, source: "model" as const, model, cached: true };
  const r = await extractDocument({ ws, leadId: null }, input, fallback);
  if (r.ok && r.source === "model")
    await query("INSERT INTO doc_cache (hash, model, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [hash, model, JSON.stringify(r.data)]);
  return { ...r, cached: false };
}

export async function readDocument(id: string, bytes: Uint8Array, { ws, allowAI = true }: { ws: string; allowAI?: boolean }): Promise<ReadResult> {
  const t0 = performance.now();
  const done = (r: Omit<ReadResult, "id" | "ms">): ReadResult => ({ id, ...r, ms: Math.round(performance.now() - t0) });

  let lines: string[];
  try {
    if ((await pageCount(bytes)) > MAX_PAGES) return done({ status: "review", readBy: "none", scan: false, reason: `more than ${MAX_PAGES} pages` });
    lines = await pdfLines(bytes);
  } catch {
    return done({ status: "review", readBy: "none", scan: false, reason: "not a readable PDF (damaged or password-protected)" });
  }
  const scan = lines.length < 3;
  const live = allowAI && !!aiProvider();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const useAI = live || (allowAI && !!shippedRead(hash));
  let fields: ExtractedDoc | null = null, readBy: ReadBy = "template", model: string | undefined, cached = false;
  let note: string | undefined;

  if (!scan) {
    const text = lines.join("\n");
    const template = readByTemplate(lines);
    if (useAI) {
      const input = aiProvider() === "anthropic" ? { text, pdfB64: Buffer.from(bytes).toString("base64") } : { text };
      const r = await cachedAi(hash, input, ws, () => template ?? {}, live);
      if (r.ok && r.source === "model") {
        const bad = ungrounded(r.data, text);
        if (bad.length) return done({ status: "review", readBy: "ai-text", model: r.model, scan, fields: r.data, reason: `AI returned values not printed on the page: ${bad.slice(0, 3).join(", ")}` });
        fields = r.data; readBy = "ai-text"; model = r.model; cached = r.cached;
      } else {
        fields = template; // model busy/failed/capped: deterministic reader, said out loud
        note = "AI was busy (rate limit), so code read this one";
      }
    } else fields = template;
    if (!fields) return done({ status: "review", readBy: "none", scan, reason: "unfamiliar layout and no AI available" });
  } else {
    const image = await scanImage(bytes).catch(() => null);
    if (!image) return done({ status: "review", readBy: "none", scan, reason: "no text and no scanned image found" });
    if (!useAI) return done({ status: "review", readBy: "none", scan, reason: "scanned invoice: needs AI or a person to read it" });
    const input = aiProvider() === "anthropic" ? { pdfB64: Buffer.from(bytes).toString("base64") } : { imageB64: image };
    const r = await cachedAi(hash, input, ws, () => ({}), live);
    if (r.source !== "model") return done({ status: "review", readBy: "none", scan, reason: "scanned invoice: AI is busy (rate limit), so a person reads it" });
    if (!r.ok) return done({ status: "review", readBy: "ai-vision", model: r.model, scan, reason: r.reason });
    fields = r.data; readBy = "ai-vision"; model = r.model; cached = r.cached;
  }

  const conv = toInvoice(id, fields);
  if ("reason" in conv) return done({ status: "review", readBy, model, cached, scan, fields, reason: conv.reason });
  return done({ status: "read", readBy, model, cached, scan, fields, invoice: conv.invoice, note });
}
