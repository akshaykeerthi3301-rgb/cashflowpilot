// Working prototype service: read a batch of real documents, reconcile against the buyer's ERP exports, summarise.
import { reconcile, type Finding } from "@/deterministic/reconcile";
import { mulDiv } from "@/deterministic/reconcile";
import { ASSUMED_ERROR_RATE_BP, ROI_DEFAULTS } from "@/deterministic/roi";
import { COMPANIES, FLAG_LABEL, fmtShort } from "@/agents/common";
import { erp, manifest, type Batch } from "./erp";
import { readDocument, type ReadResult } from "./read";
import { docBytes } from "./erp";

const CONCURRENCY = 4;

export async function readAll<T>(items: T[], fn: (x: T) => Promise<ReadResult>): Promise<ReadResult[]> {
  const out: ReadResult[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export type DocReport = Omit<ReadResult, "invoice"> & {
  supplier?: string; number?: string; amount?: string; flags: string[]; labels: string[]; atRisk?: string; confirm: boolean;
};

// Findings on a scan read by AI are reported but marked "confirm" — a person checks the image before acting.
export function report(results: ReadResult[], findings: Finding[], currency: "INR" | "USD") {
  const byId = new Map(findings.map((f) => [f.invoiceId, f]));
  const docs: DocReport[] = results.map(({ invoice, ...r }) => {
    const f = byId.get(r.id);
    return {
      ...r,
      supplier: invoice?.supplierName,
      number: invoice?.number,
      amount: invoice ? fmtShort(invoice.grandTotal, invoice.currency) : undefined,
      flags: f?.flags ?? [],
      labels: (f?.flags ?? []).map((x) => FLAG_LABEL[x] ?? x),
      atRisk: f && f.overbilled ? fmtShort(f.overbilled, currency) : undefined,
      confirm: !!(r.scan && f?.flags.length),
    };
  });
  const atRisk = findings.reduce((s, f) => s + f.overbilled, 0);
  const byCheck: Record<string, number> = {};
  for (const f of findings) for (const x of f.flags) byCheck[FLAG_LABEL[x] ?? x] = (byCheck[FLAG_LABEL[x] ?? x] ?? 0) + 1;
  return {
    docs,
    summary: {
      total: results.length,
      read: results.filter((r) => r.status === "read").length,
      review: results.filter((r) => r.status === "review").length,
      flagged: findings.filter((f) => f.flags.length).length,
      byAI: results.filter((r) => r.readBy.startsWith("ai")).length,
      byTemplate: results.filter((r) => r.readBy === "template").length,
      atRisk: fmtShort(atRisk, currency),
      atRiskMinor: atRisk,
      seconds: (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1),
      manualHours: ((results.length * ROI_DEFAULTS.minutesPerInvoice) / 60).toFixed(1),
      byCheck,
    },
  };
}

export async function processBatch(ws: string, batch: Batch) {
  const m = manifest()[batch];
  const results = await readAll(m.docs, (id) => readDocument(id, docBytes(batch, id)!, { ws }));
  const { pos, grns } = erp(batch);
  const findings = reconcile(results.flatMap((r) => (r.invoice ? [r.invoice] : [])), pos, grns);
  const company = COMPANIES.find((c) => c.id === batch);
  const rep = report(results, findings, m.currency);
  return {
    batch, buyer: m.buyer, currency: m.currency, ...rep,
    roi: company && {
      monthlySpend: fmtShort(company.monthlyApSpend, company.currency),
      protectedPerMonth: fmtShort(mulDiv(company.monthlyApSpend, ASSUMED_ERROR_RATE_BP, 10000), company.currency),
      hoursPerMonth: String(Math.round((company.monthlyInvoices * ROI_DEFAULTS.minutesPerInvoice) / 60)),
      errorRate: `${ASSUMED_ERROR_RATE_BP / 100}%`,
    },
  };
}
