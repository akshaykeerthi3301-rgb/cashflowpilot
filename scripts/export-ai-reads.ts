// Ships the AI's real reads of the SAMPLE PDFs with the app (data/prototype/ai-reads.json).
// Only hashes of files listed in the manifest are exported — never anything a visitor uploaded.
// Run after `npm run eval:ai`:  npm run export:ai-reads
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { query } from "../src/db";
import { BATCHES, docBytes, manifest } from "../src/documents/erp";
import { ExtractedDocSchema } from "../src/schemas";

async function main() {
  const sample = new Map<string, string>(); // hash -> doc id
  for (const b of BATCHES) for (const id of manifest()[b].docs) sample.set(createHash("sha256").update(docBytes(b, id)!).digest("hex"), id);
  const rows = await query<{ hash: string; model: string; result: unknown }>("SELECT hash, model, result FROM doc_cache ORDER BY created_at");
  const out: Record<string, { model: string; result: unknown }> = {};
  for (const r of rows) if (sample.has(r.hash) && ExtractedDocSchema.safeParse(r.result).success) out[r.hash] = { model: r.model, result: r.result };
  writeFileSync("data/prototype/ai-reads.json", JSON.stringify(out, null, 1));
  console.log(`Exported AI reads for ${Object.keys(out).length} of ${sample.size} sample PDFs.`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
