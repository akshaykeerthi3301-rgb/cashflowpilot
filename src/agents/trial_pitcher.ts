import { query } from "@/db";
import { reconcile } from "@/deterministic/reconcile";
import { hydrate } from "@/deterministic/hydrate";
import { roi } from "@/deterministic/roi";
import { intentScore } from "@/deterministic/scoring";
import { answerQuestion, extractInvoice } from "@/providers/llm";
import { trialActivity } from "@/providers/world";
import { audit } from "@/state_machine";
import { DATA, company, fmtMoney, toReview, type Lead, type Trial } from "./common";
import type { Invoice } from "@/schemas";

// Turn text-only invoices into structured ones via AI; anything unsure goes to review, never guessed.
export async function prepareBatch(ws: string, leadId: string, invoices: Invoice[]) {
  const ready: Invoice[] = [], reviewed: string[] = [];
  for (const inv of invoices) {
    if (!inv.raw) {
      ready.push(inv);
      continue;
    }
    const ex = await extractInvoice({ ws, leadId }, inv.raw);
    if (ex.ok) ready.push(hydrate(inv, ex.data));
    else {
      reviewed.push(inv.id);
      await toReview(ws, leadId, `Invoice ${inv.id} unreadable: ${ex.reason}`, { raw: inv.raw });
    }
  }
  return { ready, reviewed };
}

// Stage 3: run the buyer's sandbox — deterministic findings, ROI, Q&A, intent.
export async function runTrial(ws: string, lead: Lead): Promise<string> {
  const c = company(lead.company_id);
  const slice = DATA.trial.invoices.filter((i) => c.suppliers.includes(i.supplierId) && i.currency === c.currency);
  const { ready, reviewed } = await prepareBatch(ws, lead.id, slice);
  const findings = reconcile(ready, DATA.trial.pos, DATA.trial.grns);
  const leakage = findings.reduce((s, f) => s + f.overbilled, 0);
  const sampleValue = ready.reduce((s, i) => s + i.grandTotal, 0);
  const r = roi({ sampleValue, leakage, monthlyInvoices: c.monthlyInvoices, monthlyApSpend: c.monthlyApSpend, annualRevenue: c.annualRevenue });
  const flagged = findings.filter((f) => f.flags.length).length;

  const act = trialActivity(lead.persona);
  const qa: Trial["qa"] = [];
  if (act.question) {
    const ans = await answerQuestion({ ws, leadId: lead.id }, act.question);
    qa.push({ q: act.question, a: ans.ok ? ans.data.answer : "Routed to the founder.", source: ans.ok ? `faq.${ans.data.faq_id}` : "review" });
    if (!ans.ok) await toReview(ws, lead.id, `Trial question not covered: ${ans.reason}`, { q: act.question });
  }
  for (const e of act.events) await audit(ws, lead.id, "system", "trial.event", { kind: e });

  const m = (x: number) => fmtMoney(x, c.currency);
  const pitch =
    `On ${ready.length} of your sample invoices we flagged ${flagged}, with ${m(leakage)} billed above what the POs and goods receipts support. ` +
    `At a conservative 1% error rate on your spend, that protects about ${m(r.protectedPerMonth)} a month, plus ${(r.hoursSavedPerMonth10 / 10).toFixed(1)} hours of matching saved.`;

  const trial: Trial = { currency: c.currency, invoiceCount: ready.length, reviewed, findings, flagged, leakage, sampleValue, roi: r, qa, events: act.events, pitch };
  const intent = intentScore(act.events);
  await query("UPDATE leads SET trial=$3, intent=$4 WHERE workspace_id=$1 AND id=$2", [ws, lead.id, JSON.stringify(trial), intent]);
  await audit(ws, lead.id, "agent", "trial.pitched", { flagged, leakage, intent });
  return `trial run: ${flagged} issues flagged, buying intent ${intent}/100`;
}
