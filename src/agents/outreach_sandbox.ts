import { query } from "@/db";
import { canSend } from "@/deterministic/limits";
import { GATES, audit, transition } from "@/state_machine";
import { answerQuestion, draftOutreach } from "@/providers/llm";
import { buyerReply } from "@/providers/world";
import { company, mail, toReview, type Lead } from "./common";

// Stage 2a: first email. Order matters: draft -> breakers -> atomic state claim -> send.
export async function sendOutreach(ws: string, lead: Lead): Promise<string> {
  if (lead.score < GATES.outreachMinScore) {
    await audit(ws, lead.id, "agent", "outreach.skipped", { reason: `score ${lead.score} below ${GATES.outreachMinScore}` });
    return `not contacted: score ${lead.score} is below ${GATES.outreachMinScore}`;
  }
  const c = company(lead.company_id);
  const hook = c.blurb.split(/[;,.]/)[0];
  const draft = await draftOutreach({ ws, leadId: lead.id }, c, hook);
  if (!draft.ok) {
    await toReview(ws, lead.id, `Outreach draft rejected: ${draft.reason}`);
    return "draft sent to human review";
  }
  const gate = await canSend(ws, lead.contact_email);
  if (!gate.ok) {
    await audit(ws, lead.id, "agent", "outreach.blocked", { reason: gate.reason });
    return `blocked: ${gate.reason}`;
  }
  const t = await transition(ws, lead.id, "OUTREACH_ACTIVE", "agent");
  if (!t.ok) return `not sent: ${t.reason}`;
  await mail(ws, lead.id, "out", draft.data.subject, draft.data.body);
  return "pitch email sent";
}

// Stage 2b: read the (simulated) reply and act on it.
export async function handleReply(ws: string, lead: Lead): Promise<string> {
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE workspace_id=$1 AND lead_id=$2 AND direction='in'", [ws, lead.id]);
  const reply = buyerReply(lead.persona, n);
  if (!reply) {
    await audit(ws, lead.id, "agent", "outreach.no_reply");
    return "no reply yet — agent waits (no spam follow-ups)";
  }
  await mail(ws, lead.id, "in", "Re: your note", reply.text);

  if (reply.kind === "opt_out") {
    await query("INSERT INTO opt_outs VALUES ($1,$2) ON CONFLICT DO NOTHING", [ws, lead.contact_email.toLowerCase()]);
    await transition(ws, lead.id, "OPTED_OUT", "agent", { reason: "buyer asked to unsubscribe" });
    return "buyer opted out — address suppressed permanently";
  }
  if (reply.kind === "question") {
    const ans = await answerQuestion({ ws, leadId: lead.id }, reply.text);
    if (!ans.ok) {
      await toReview(ws, lead.id, `Could not answer from approved docs: ${ans.reason}`, { question: reply.text });
      return "question routed to founder";
    }
    const gate = await canSend(ws, lead.contact_email, { cold: false });
    if (!gate.ok) return `answer held: ${gate.reason}`;
    await mail(ws, lead.id, "out", "Re: security", `${ans.data.answer}\n\n(Source: approved FAQ "${ans.data.faq_id}")`);
    return "answered from approved FAQ";
  }
  const gate = await canSend(ws, lead.contact_email, { cold: false });
  if (!gate.ok) return `trial invite held: ${gate.reason}`;
  const t = await transition(ws, lead.id, "SANDBOX_TRIAL", "agent");
  if (!t.ok) return `not moved: ${t.reason}`;
  await mail(
    ws,
    lead.id,
    "out",
    "Your CashFlowPilot sandbox is ready",
    "Your isolated sandbox is live with a sample dataset shaped like your supplier base. You can also upload a CSV export. It has no access to your ERP, bank or payment systems.",
  );
  return "sandbox trial opened";
}
