import { query } from "@/db";
import { FLAGS } from "@/schemas";
import { GATES, audit, transition } from "@/state_machine";
import { writeBrief } from "@/providers/llm";
import { nextSlot } from "@/providers/calendar";
import { canSend } from "@/deterministic/limits";
import { company, fmtMoney, mail, toReview, type Lead } from "./common";

// Stage 4: intent gate -> code-computed facts -> AI narrative (number-checked) -> book -> LOCK.
export async function prepAndBook(ws: string, lead: Lead): Promise<string> {
  if (lead.intent < GATES.dealPrepMinIntent) {
    await audit(ws, lead.id, "agent", "deal_prep.waiting", { intent: lead.intent });
    return `waiting: buying intent ${lead.intent} is below ${GATES.dealPrepMinIntent}`;
  }
  const t = lead.trial!;
  const c = company(lead.company_id);
  const m = (x: number) => fmtMoney(x, t.currency);
  const byFlag = FLAGS.map((f) => [f, t.findings.filter((x) => x.flags.includes(f)).length] as const).filter(([, n]) => n);
  const facts: Record<string, string> = {
    company: c.name,
    contact: `${c.contact.name}, ${c.contact.role}`,
    industry: c.industry,
    erp: c.erp,
    invoices: String(t.invoiceCount),
    flagged: String(t.flagged),
    by_type: byFlag.map(([f, n]) => `${f} x${n}`).join(", "),
    leakage: m(t.leakage),
    protected_per_month: m(t.roi.protectedPerMonth),
    error_rate: `${t.roi.assumptions.errorRateBp / 100}%`,
    hours_saved: (t.roi.hoursSavedPerMonth10 / 10).toFixed(1),
    dso_days: String(t.roi.assumptions.dsoReductionDays),
    working_capital: m(t.roi.workingCapitalFreed),
    intent: String(lead.intent),
    questions: t.qa.map((x) => x.q).join(" | ") || "none",
  };
  const narrative = await writeBrief({ ws, leadId: lead.id }, facts, lead.persona);
  if (!narrative.ok) {
    await toReview(ws, lead.id, `Brief rejected: ${narrative.reason}`);
    return "brief sent to human review";
  }
  const taken = (await query<{ call_at: string }>("SELECT call_at FROM leads WHERE workspace_id=$1 AND call_at IS NOT NULL", [ws])).map((r) => r.call_at);
  const slot = nextSlot(taken);
  const brief = { facts, narrative: narrative.data, source: narrative.source };
  await query("UPDATE leads SET brief=$3, call_at=$4 WHERE workspace_id=$1 AND id=$2 AND state='SANDBOX_TRIAL'", [ws, lead.id, JSON.stringify(brief), slot]);

  const booked = await transition(ws, lead.id, "CALL_BOOKED", "agent", { call_at: slot });
  if (!booked.ok) return `not booked: ${booked.reason}`;
  if ((await canSend(ws, lead.contact_email, { cold: false })).ok)
    await mail(ws, lead.id, "out", "Call confirmed", `Booked a 30-minute call with our founder for ${slot} (UTC). Calendar invite attached.`);
  const held = await transition(ws, lead.id, "PRE_SALE_HOLD", "agent");
  return held.ok ? "brief written, call booked — deal LOCKED until the founder signs off" : `hold failed: ${held.reason}`;
}
