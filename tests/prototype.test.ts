import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetDbForTests } from "@/db";
import { pdfLines } from "@/documents/pdf";
import { readByTemplate } from "@/documents/template";
import { readDocument, resetShippedReads, ungrounded } from "@/documents/read";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { processBatch } from "@/documents/batch";
import { BATCHES, docBytes, manifest } from "@/documents/erp";
import type { Flag, Invoice } from "@/schemas";

type Truth = Record<string, { invoices: (Invoice & { cgst: number; sgst: number; igst: number })[]; answerKey: Record<string, Flag[]>; scans: string[] }>;
const truth: Truth = JSON.parse(readFileSync("data/prototype/truth.json", "utf8"));

beforeEach(async () => {
  await resetDbForTests();
  delete process.env.GROQ_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe("reading real PDFs without any AI key", () => {
  for (const batch of BATCHES) {
    test(`${batch}: template reader recovers every text invoice exactly`, async () => {
      for (const t of truth[batch].invoices) {
        if (truth[batch].scans.includes(t.id)) continue;
        const r = await readDocument(t.id, docBytes(batch, t.id)!, { ws: "w" });
        expect(r.status, t.id).toBe("read");
        const inv = r.invoice!;
        expect([inv.number, inv.poNumber, inv.supplierId, inv.grandTotal, inv.taxTotal, inv.taxType, inv.amountInWords], t.id)
          .toEqual([t.number, t.poNumber, t.supplierId, t.grandTotal, t.taxTotal, t.taxType, t.amountInWords]);
        expect(inv.lines.map((l) => [l.sku, l.qty, l.unitPrice, l.gstRate]), t.id).toEqual(t.lines.map((l) => [l.sku, l.qty, l.unitPrice, l.gstRate]));
        expect(inv.surcharges, t.id).toEqual(t.surcharges);
      }
    });

    test(`${batch}: every readable invoice gets exactly its planted problem; scans go to a person`, async () => {
      const res = await processBatch("w", batch);
      for (const d of res.docs) {
        if (truth[batch].scans.includes(d.id)) {
          expect(d.status, d.id).toBe("review");
          continue;
        }
        expect([...d.flags].sort(), d.id).toEqual([...truth[batch].answerKey[d.id]].sort());
      }
      expect(res.summary.review).toBe(truth[batch].scans.length);
    });
  }
});

describe("AI safeguards", () => {
  const groqReply = (doc: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(doc) } }] }), { status: 200, headers: { "content-type": "application/json" } });

  test("grounding rejects a number the page does not contain", async () => {
    const bytes = docBytes("kaveri", "KN-002")!;
    const doc = readByTemplate(await pdfLines(bytes))!;
    expect(ungrounded(doc, (await pdfLines(bytes)).join("\n"))).toEqual([]);
    const invented = { ...doc, grandTotal: "4,97,316.00" };
    process.env.GROQ_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => groqReply(invented)));
    const r = await readDocument("KN-002", bytes, { ws: "w" });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/not printed on the page: 4,97,316.00/);
  });

  test("a correct AI read is accepted, labelled with the model, and cached", async () => {
    const bytes = docBytes("kaveri", "KN-003")!;
    const doc = readByTemplate(await pdfLines(bytes))!;
    process.env.GROQ_API_KEY = "test";
    const spy = vi.fn(async () => groqReply(doc));
    vi.stubGlobal("fetch", spy);
    const a = await readDocument("KN-003", bytes, { ws: "w" });
    const b = await readDocument("KN-003", bytes, { ws: "w" });
    expect([a.status, a.readBy, a.model, a.cached]).toEqual(["read", "ai-text", "openai/gpt-oss-120b", false]);
    expect(b.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a scan read by AI whose line arithmetic fails goes to a person", async () => {
    const scanId = truth.kaveri.scans[0];
    const t = truth.kaveri.invoices.find((x) => x.id === scanId)!;
    const misread = {
      invoiceNumber: t.number, invoiceDate: t.date, poNumber: t.poNumber, supplierName: t.supplierName, supplierGstin: t.supplierGstin,
      buyerGstin: t.buyerGstin, placeOfSupplyCode: "29", currency: "INR",
      lines: t.lines.map((l) => ({ sku: l.sku, description: l.description, hsn: l.hsn, qty: String(l.qty + 1), rate: "1.00", gstRate: `${l.gstRate}%`, amount: "9.00" })),
      charges: [], cgst: "", sgst: "", igst: "1.00", roundOff: "0.00", grandTotal: "10.00", amountInWords: "Rupees Ten Only", confidence: 0.9,
    };
    process.env.GROQ_API_KEY = "test";
    const spy = vi.fn(async () => groqReply(misread));
    vi.stubGlobal("fetch", spy);
    const r = await readDocument(scanId, docBytes("kaveri", scanId)!, { ws: "w" });
    expect(r.readBy).toBe("ai-vision");
    expect(r.model).toBe("qwen/qwen3.8-27b");
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/line 1/);
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/); // the scan image was sent
  });

  test("shipped AI reads are used without a key, and still grounded and checked", async () => {
    const bytes = docBytes("kaveri", "KN-003")!;
    const doc = readByTemplate(await pdfLines(bytes))!;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "reads-")), "ai-reads.json");
    writeFileSync(file, JSON.stringify({ [hash]: { model: "openai/gpt-oss-120b", result: doc } }));
    process.env.AI_READS_FILE = path.relative(process.cwd(), file);
    resetShippedReads();
    try {
      const r = await readDocument("KN-003", bytes, { ws: "w" });
      expect([r.status, r.readBy, r.model, r.cached]).toEqual(["read", "ai-text", "openai/gpt-oss-120b", true]);
      writeFileSync(file, JSON.stringify({ [hash]: { model: "openai/gpt-oss-120b", result: { ...doc, grandTotal: "9,99,999.00" } } }));
      resetShippedReads();
      expect((await readDocument("KN-003", bytes, { ws: "w" })).status).toBe("review"); // grounding applies to shipped reads too
    } finally {
      process.env.AI_READS_FILE = "";
      resetShippedReads();
    }
  });

  test("tax and round-off rows listed as 'charges' are not double-counted; blank item codes go to a person", async () => {
    const { toInvoice } = await import("@/documents/read");
    const doc = readByTemplate(await pdfLines(docBytes("kaveri", "KN-003")!))!; // an IGST invoice
    const noisy = { ...doc, charges: [{ label: "IGST", amount: doc.igst }, { label: "Rounding", amount: doc.roundOff }, { label: "Add: Freight", amount: "500.00" }] };
    const r = toInvoice("KN-003", noisy);
    expect("invoice" in r && r.invoice.surcharges).toEqual([{ label: "Freight", amount: 50000 }]);
    const blank = toInvoice("KN-003", { ...doc, lines: doc.lines.map((l) => ({ ...l, sku: "" })) });
    expect(blank).toEqual({ reason: "item code missing on line 1" });
  });

  test("broken uploads are rejected with a clear reason", async () => {
    const r = await readDocument("U-1", new TextEncoder().encode("not a pdf"), { ws: "w" });
    expect(r).toMatchObject({ status: "review", reason: "not a readable PDF (damaged or password-protected)" });
  });
});

test("manifest lists only files that exist", () => {
  for (const b of BATCHES) for (const id of manifest()[b].docs) expect(docBytes(b, id)).not.toBeNull();
  expect(docBytes("kaveri", "../../package")).toBeNull();
});
