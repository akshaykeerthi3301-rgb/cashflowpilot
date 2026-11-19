import { query } from "@/db";
import { scoreLead } from "@/deterministic/scoring";
import { extractSignals } from "@/providers/llm";
import { audit } from "@/state_machine";
import { COMPANIES, toReview } from "./common";

// Stage 1: discover fictional companies, let AI read growth/hiring signals, score fit with code.
export async function research(ws: string): Promise<number> {
  let added = 0;
  for (const c of COMPANIES) {
    const exists = await query("SELECT 1 FROM leads WHERE workspace_id=$1 AND id=$2", [ws, c.id]);
    if (exists.length) continue;
    // Lead row first so AI calls are budgeted against it.
    await query(
      `INSERT INTO leads (workspace_id, id, company_id, name, industry, region, persona, contact_name, contact_role, contact_email)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [ws, c.id, c.name, c.industry, c.region, c.persona, c.contact.name, c.contact.role, c.contact.email],
    );
    const sig = await extractSignals({ ws, leadId: c.id }, c);
    if (!sig.ok) await toReview(ws, c.id, `Signals unclear (${sig.reason}); scored on firmographics only`, { blurb: c.blurb });
    const { score, breakdown } = scoreLead(c, sig.ok ? sig.data : null);
    await query("UPDATE leads SET score=$3, score_breakdown=$4 WHERE workspace_id=$1 AND id=$2", [ws, c.id, score, JSON.stringify(breakdown)]);
    await audit(ws, c.id, "agent", "research.scored", { score, signals: sig.ok ? sig.data : null });
    added++;
  }
  return added;
}
