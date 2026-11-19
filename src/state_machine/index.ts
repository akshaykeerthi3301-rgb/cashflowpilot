import { query } from "@/db";
import { ReleaseDirectiveSchema, type Actor, type State } from "@/schemas";

export const TRANSITIONS: Record<State, State[]> = {
  DISCOVERED: ["OUTREACH_ACTIVE", "CLOSED_LOST"],
  OUTREACH_ACTIVE: ["SANDBOX_TRIAL", "OPTED_OUT", "CLOSED_LOST"],
  SANDBOX_TRIAL: ["CALL_BOOKED", "OPTED_OUT", "CLOSED_LOST"],
  CALL_BOOKED: ["PRE_SALE_HOLD", "CLOSED_LOST"],
  PRE_SALE_HOLD: ["PROVISIONING", "CLOSED_LOST"],
  PROVISIONING: ["STAGE_A_SHADOW_MODE"],
  STAGE_A_SHADOW_MODE: ["STAGE_B_PRODUCTION_ACTIVE"],
  STAGE_B_PRODUCTION_ACTIVE: [],
  OPTED_OUT: [],
  CLOSED_LOST: [],
};

export const GATES = {
  outreachMinScore: 60,
  dealPrepMinIntent: 70,
  stageBMinDecided: 50,
  stageBMinAccuracyBp: 9500,
} as const;

// What the guards need to know about a lead. Pure data so guards are unit-testable.
export type LeadGateView = {
  id: string;
  state: State;
  score: number;
  intent: number;
  brief: unknown;
  call_at: string | null;
  deal_status: string | null;
  shadow: { decided: number; accuracyBp: number } | null;
};

type Verdict = { ok: true } | { ok: false; reason: string };

export function checkTransition(lead: LeadGateView, to: State, actor: Actor, directive?: unknown): Verdict {
  if (!TRANSITIONS[lead.state].includes(to)) return { ok: false, reason: `illegal jump ${lead.state} -> ${to}` };
  switch (to) {
    case "OUTREACH_ACTIVE":
      if (lead.score < GATES.outreachMinScore) return { ok: false, reason: `score ${lead.score} < ${GATES.outreachMinScore}` };
      break;
    case "CALL_BOOKED":
      if (lead.intent < GATES.dealPrepMinIntent) return { ok: false, reason: `intent ${lead.intent} < ${GATES.dealPrepMinIntent}` };
      break;
    case "PRE_SALE_HOLD":
      if (!lead.brief || !lead.call_at) return { ok: false, reason: "brief and booked call required" };
      break;
    case "PROVISIONING": {
      // THE hard pre-sale lock.
      if (actor !== "founder") return { ok: false, reason: "only the founder can release a deal" };
      if (lead.deal_status !== "CLOSED_WON") return { ok: false, reason: "deal is not CLOSED_WON" };
      const d = ReleaseDirectiveSchema.safeParse(directive);
      if (!d.success) return { ok: false, reason: "missing or invalid Release Directive" };
      if (d.data.lead_id !== lead.id) return { ok: false, reason: "Release Directive is for a different lead" };
      break;
    }
    case "STAGE_B_PRODUCTION_ACTIVE": {
      if (actor !== "founder") return { ok: false, reason: "only the founder can enable Stage B" };
      const s = lead.shadow;
      if (!s || s.decided < GATES.stageBMinDecided)
        return { ok: false, reason: `shadow mode needs >= ${GATES.stageBMinDecided} decided invoices` };
      if (s.accuracyBp < GATES.stageBMinAccuracyBp)
        return { ok: false, reason: `shadow accuracy ${s.accuracyBp / 100}% < ${GATES.stageBMinAccuracyBp / 100}%` };
      break;
    }
  }
  return { ok: true };
}

export async function audit(ws: string, leadId: string | null, actor: Actor | "system", action: string, detail: unknown = {}) {
  await query("INSERT INTO audit (workspace_id, lead_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)", [
    ws,
    leadId,
    actor,
    action,
    JSON.stringify(detail),
  ]);
}

// The ONLY writer of leads.state. Guard check + compare-and-set update + audit row.
// `WHERE state = $from` makes a double-click a no-op instead of a double transition.
export async function transition(ws: string, leadId: string, to: State, actor: Actor, detail: Record<string, unknown> = {}): Promise<Verdict> {
  const [lead] = await query<LeadGateView>(
    "SELECT id, state, score, intent, brief, call_at, deal_status, shadow FROM leads WHERE workspace_id=$1 AND id=$2",
    [ws, leadId],
  );
  if (!lead) return { ok: false, reason: "lead not found" };
  const [dir] = await query<{ data: unknown }>("SELECT data FROM directives WHERE workspace_id=$1 AND lead_id=$2", [ws, leadId]);
  const verdict = checkTransition(lead, to, actor, dir?.data);
  if (!verdict.ok) {
    await audit(ws, leadId, actor, "transition.rejected", { from: lead.state, to, reason: verdict.reason });
    return verdict;
  }
  const moved = await query(
    `WITH upd AS (UPDATE leads SET state=$3 WHERE workspace_id=$1 AND id=$2 AND state=$4 RETURNING id)
     INSERT INTO audit (workspace_id, lead_id, actor, action, detail)
     SELECT $1, id, $5, 'transition', $6 FROM upd RETURNING id`,
    [ws, leadId, to, lead.state, actor, JSON.stringify({ from: lead.state, to, ...detail })],
  );
  return moved.length ? { ok: true } : { ok: false, reason: "state changed concurrently" };
}
