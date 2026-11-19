import { parseInvoiceCsv } from "@/deterministic/csv";
import { reconcile } from "@/deterministic/reconcile";
import { audit } from "@/state_machine";
import { apiWs, json } from "../../../../server";

const MAX_BYTES = 200_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ ok: false, errors: ["file too large (200 KB max)"] }, 400);
  const p = parseInvoiceCsv(text);
  if (!p.ok) return json(p, 400);
  const findings = reconcile(p.invoices, [], [], { poChecks: false });
  await audit(ws, (await params).id, "system", "trial.upload", { invoices: p.invoices.length, flagged: findings.filter((f) => f.flags.length).length });
  return json({ ok: true, invoices: p.invoices.map((i) => ({ id: i.id, number: i.number, currency: i.currency, grandTotal: i.grandTotal })), findings });
}
