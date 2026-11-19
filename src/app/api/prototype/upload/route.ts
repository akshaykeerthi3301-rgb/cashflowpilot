import { bumpUsage } from "@/deterministic/limits";
import { reconcile } from "@/deterministic/reconcile";
import { readAll, report } from "@/documents/batch";
import { readDocument } from "@/documents/read";
import { apiWs, json } from "../../../server";

const MAX_FILES = 5, MAX_BYTES = 2_000_000, UPLOADS_PER_DAY = 5;

// Visitor's own invoices: read + document-level checks (no purchase orders to match against). Nothing is stored.
export async function POST(req: Request) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return json({ error: "Choose at least one PDF." }, 400);
  if (files.length > MAX_FILES) return json({ error: `Up to ${MAX_FILES} files at a time.` }, 400);
  const bad = files.find((f) => f.size > MAX_BYTES);
  if (bad) return json({ error: `${bad.name} is larger than 2 MB.` }, 400);
  const items = await Promise.all(files.map(async (f, i) => ({ id: `U-${i + 1}`, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const notPdf = items.find((x) => new TextDecoder().decode(x.bytes.slice(0, 5)) !== "%PDF-");
  if (notPdf) return json({ error: `${notPdf.name} is not a PDF.` }, 400);
  if (!(await bumpUsage(ws, "uploads", UPLOADS_PER_DAY))) return json({ error: "Daily upload limit reached for this demo." }, 429);
  const results = await readAll(items, (x) => readDocument(x.id, x.bytes, { ws }));
  const invoices = results.flatMap((r) => (r.invoice ? [r.invoice] : []));
  const currency = invoices[0]?.currency ?? "INR";
  const rep = report(results, reconcile(invoices, [], [], { poChecks: false }), currency);
  return json({ ...rep, names: Object.fromEntries(items.map((x) => [x.id, x.name])) });
}
