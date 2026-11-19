// Measures how accurately the configured AI reads the prototype's PDFs, against ground truth.
// Costs real API calls (free within Groq's limits). Run: npm run eval:ai            (uses cached reads)
//                                                       npm run eval:ai -- --fresh  (re-reads everything)
import { readFileSync } from "node:fs";
import { query } from "../src/db";
import { BATCHES, docBytes, erp } from "../src/documents/erp";
import { readAll } from "../src/documents/batch";
import { readDocument } from "../src/documents/read";
import { reconcile } from "../src/deterministic/reconcile";
import { aiProvider, modelName } from "../src/providers/llm";
import type { Flag, Invoice } from "../src/schemas";

type Truth = Record<string, { invoices: Invoice[]; answerKey: Record<string, Flag[]>; scans: string[] }>;

process.env.AI_MAX_WAIT_MS = "180000"; // a batch script can wait out Groq's per-minute limit

async function main() {
  if (!aiProvider()) throw new Error("No AI key found. Add GROQ_API_KEY (or ANTHROPIC_API_KEY) to .env.local first.");
  if (process.argv.includes("--fresh")) await query("DELETE FROM doc_cache");
  const truth: Truth = JSON.parse(readFileSync("data/prototype/truth.json", "utf8"));
  console.log(`Provider: ${aiProvider()} · text model ${modelName()} · scan model ${modelName({ imageB64: "x" })}\n`);
  let aiFields = 0, aiRight = 0, fields = 0, right = 0, docs = 0, reviewed = 0, aiRead = 0, endToEnd = 0, decided = 0;
  const misses: string[] = [];
  for (const batch of BATCHES) {
    const t = truth[batch];
    const results = await readAll(t.invoices, (inv) => readDocument(inv.id, docBytes(batch, inv.id)!, { ws: "eval" }));
    for (const r of results) {
      docs++;
      if (r.readBy.startsWith("ai")) aiRead++;
      if (r.status === "review") { reviewed++; misses.push(`${r.id}: to a person (${r.reason})`); continue; }
      const truthInv = t.invoices.find((x) => x.id === r.id)!, got = r.invoice!;
      const pairs: [string, unknown, unknown][] = [
        ["number", got.number, truthInv.number], ["po", got.poNumber, truthInv.poNumber], ["gstin", got.supplierGstin ?? "", truthInv.supplierGstin ?? ""],
        ["total", got.grandTotal, truthInv.grandTotal], ["tax", got.taxTotal, truthInv.taxTotal], ["words", got.amountInWords, truthInv.amountInWords],
        ["lines", JSON.stringify(got.lines.map((l) => [l.sku, l.hsn, l.qty, l.unitPrice, l.gstRate])), JSON.stringify(truthInv.lines.map((l) => [l.sku, l.hsn, l.qty, l.unitPrice, l.gstRate]))],
        ["charges", JSON.stringify(got.surcharges), JSON.stringify(truthInv.surcharges)],
        ["round-off", got.roundOff ?? 0, truthInv.roundOff ?? 0],
        ["place of supply", got.buyerState, truthInv.buyerState],
        ["tax type", got.taxType, truthInv.taxType],
      ];
      const ai = r.readBy.startsWith("ai");
      for (const [k, a, b] of pairs) {
        fields++; if (ai) aiFields++;
        if (a === b) { right++; if (ai) aiRight++; }
        else misses.push(`${r.id} [${r.readBy}]: ${k} read as ${String(a).slice(0, 60)} (truth ${String(b).slice(0, 60)})`);
      }
    }
    const { pos, grns } = erp(batch);
    for (const f of reconcile(results.flatMap((r) => (r.invoice ? [r.invoice] : [])), pos, grns)) {
      decided++;
      const want = t.answerKey[f.invoiceId];
      if (f.flags.length === want.length && f.flags.every((x) => want.includes(x))) endToEnd++;
    }
  }
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0") + "%";
  console.log(`Documents: ${docs} · read by AI: ${aiRead} · handed to a person: ${reviewed}`);
  console.log(`Field accuracy, AI reads only: ${aiRight}/${aiFields} = ${pct(aiRight, aiFields)}`);
  console.log(`Field accuracy, everything accepted (AI + code): ${right}/${fields} = ${pct(right, fields)}`);
  console.log(`Final verdict matches the answer key: ${endToEnd}/${decided} = ${pct(endToEnd, decided)}`);
  if (misses.length) console.log(`\nDetails:\n  ${misses.join("\n  ")}`);
}
main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
