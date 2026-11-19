import { query } from "@/db";
import { reconcile } from "@/deterministic/reconcile";
import { scorecard } from "@/deterministic/shadow";
import { ReleaseDirectiveSchema } from "@/schemas";
import { audit, transition } from "@/state_machine";
import { DATA, getLead } from "./common";
import { prepareBatch } from "./trial_pitcher";

// Founder-only entry point. The agent has no code path that sets CLOSED_WON.
export async function founderCloseWon(ws: string, leadId: string, input: unknown) {
  const lead = await getLead(ws, leadId);
  if (!lead) return { ok: false as const, errors: ["lead not found"] };
  if (lead.state !== "PRE_SALE_HOLD") return { ok: false as const, errors: [`lead is ${lead.state}, not PRE_SALE_HOLD`] };
  const d = ReleaseDirectiveSchema.safeParse(input);
  if (!d.success) return { ok: false as const, errors: d.error.issues.map((i) => `${i.path.join(".") || "directive"}: ${i.message}`) };

  await query("INSERT INTO directives VALUES ($1,$2,$3) ON CONFLICT (workspace_id, lead_id) DO UPDATE SET data=$3", [ws, leadId, JSON.stringify(d.data)]);
  await query("UPDATE leads SET deal_status='CLOSED_WON' WHERE workspace_id=$1 AND id=$2 AND state='PRE_SALE_HOLD'", [ws, leadId]);
  await audit(ws, leadId, "founder", "deal.closed_won", { signed_by: d.data.signed_by, deal_value: d.data.deal_value });
  const t = await transition(ws, leadId, "PROVISIONING", "founder");
  if (!t.ok) return { ok: false as const, errors: [t.reason] };
  await runShadow(ws, leadId, d.data.allowed_systems);
  return { ok: true as const };
}

// Demo button: proves the lock by letting the agent try.
export function agentTryProvision(ws: string, leadId: string) {
  return transition(ws, leadId, "PROVISIONING", "agent");
}

// Stage 5: provision a read-only tenant and score the agent against the customer's own decisions.
async function runShadow(ws: string, leadId: string, systems: string[]) {
  await audit(ws, leadId, "agent", "tenant.provisioned", { mode: "read_only", systems, can_post: false, can_pay: false });
  const { ready, reviewed } = await prepareBatch(ws, leadId, DATA.shadow.invoices);
  const card = scorecard(reconcile(ready, DATA.shadow.pos, DATA.shadow.grns), DATA.shadow.answerKey, reviewed);
  await query("UPDATE leads SET shadow=$3 WHERE workspace_id=$1 AND id=$2", [ws, leadId, JSON.stringify(card)]);
  await transition(ws, leadId, "STAGE_A_SHADOW_MODE", "agent", { decided: card.decided, accuracyBp: card.accuracyBp });
}

export function promoteStageB(ws: string, leadId: string) {
  return transition(ws, leadId, "STAGE_B_PRODUCTION_ACTIVE", "founder");
}
