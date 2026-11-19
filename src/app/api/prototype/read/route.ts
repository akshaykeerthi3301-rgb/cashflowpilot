import { BATCHES, docBytes, type Batch } from "@/documents/erp";
import { readDocument } from "@/documents/read";
import { apiWs, json } from "../../../server";

// Reads ONE document so the page can show progress live. Money is not computed here (see /reconcile).
export async function POST(req: Request) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const { batch, id } = (await req.json().catch(() => ({}))) as { batch?: string; id?: string };
  if (!batch || !BATCHES.includes(batch as Batch) || !id) return json({ error: "unknown document" }, 400);
  const bytes = docBytes(batch, id);
  if (!bytes) return json({ error: "unknown document" }, 404);
  const { invoice, ...r } = await readDocument(id, bytes, { ws });
  return json({ ...r, supplier: invoice?.supplierName, number: invoice?.number });
}
