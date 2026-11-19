import { BATCHES, type Batch } from "@/documents/erp";
import { processBatch } from "@/documents/batch";
import { apiWs, json } from "../../../server";

// Re-reads the batch on the server (cached AI reads, so this is fast) — results are never taken from the browser.
export async function POST(req: Request) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const { batch } = (await req.json().catch(() => ({}))) as { batch?: string };
  if (!batch || !BATCHES.includes(batch as Batch)) return json({ error: "unknown batch" }, 400);
  return json(await processBatch(ws, batch as Batch));
}
