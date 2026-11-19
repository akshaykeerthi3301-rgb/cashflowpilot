// Drives the visitor-facing run: each stage advances every lead that is ready for it and returns what the
// animation needs. All figures come from the real agent; money is formatted here, never computed in the browser.
import { query } from "@/db";
import { resetWorkspace } from "@/workspace";
import { GATES } from "@/state_machine";
import { advance } from "./advance";
import { research } from "./researcher";
import { DATA, FLAG_LABEL, company, fmtShort, getLead, type Lead } from "./common";

export const HERO = "kaveri";
export const STAGES = ["research", "outreach", "replies", "trial", "book"] as const;
export type Stage = (typeof STAGES)[number];
export const DEMO_DEAL_VALUE = { INR: 120_000_000, USD: 2_400_000 } as const; // ₹12 lakh / $24K a year

const leadsIn = (ws: string, state: string) =>
  query<Lead>("SELECT * FROM leads WHERE workspace_id=$1 AND state=$2 ORDER BY score DESC, id", [ws, state]);

export async function runStage(ws: string, stage: Stage) {
  switch (stage) {
    case "research": {
      await resetWorkspace(ws); // every run starts clean
      await research(ws);
      const all = await query<Lead>("SELECT * FROM leads WHERE workspace_id=$1 ORDER BY score DESC, id", [ws]);
      const h = all.find((l) => l.id === HERO)!;
      return {
        hero: { name: h.name, contact: `${h.contact_name}, ${h.contact_role}` },
        threshold: GATES.outreachMinScore,
        companies: all.map((l) => ({ name: l.name, industry: l.industry, region: l.region, score: l.score, fit: l.score >= GATES.outreachMinScore })),
      };
    }

    case "outreach": {
      const ready = await leadsIn(ws, "DISCOVERED");
      const emails: { company: string; to: string }[] = [];
      for (const l of ready) if ((await advance(ws, l.id)).state === "OUTREACH_ACTIVE") emails.push({ company: l.name, to: `${l.contact_name}, ${l.contact_role}` });
      const [sample] = await query<{ subject: string; body: string }>(
        "SELECT subject, body FROM outbox WHERE workspace_id=$1 AND lead_id=$2 AND direction='out' ORDER BY id LIMIT 1", [ws, HERO]);
      return { emails, skipped: ready.length - emails.length, sample };
    }

    case "replies": {
      // Two passes: a skeptical buyer asks first, gets an answer from approved docs, then says yes.
      for (let pass = 0; pass < 2; pass++) for (const l of await leadsIn(ws, "OUTREACH_ACTIVE")) await advance(ws, l.id);
      const leads = await query<Lead & { first_reply: string | null; replies: number }>(
        `SELECT l.*, (SELECT body FROM outbox o WHERE o.workspace_id=l.workspace_id AND o.lead_id=l.id AND direction='in' ORDER BY id LIMIT 1) AS first_reply,
                (SELECT count(*)::int FROM outbox o WHERE o.workspace_id=l.workspace_id AND o.lead_id=l.id AND direction='in') AS replies
         FROM leads l WHERE workspace_id=$1 AND state <> 'DISCOVERED' ORDER BY score DESC, id`, [ws]);
      return {
        replies: leads.map((l) => ({
          company: l.name,
          contact: l.contact_name,
          text: l.first_reply,
          outcome: l.state === "OPTED_OUT" ? "unsubscribed" : l.state === "SANDBOX_TRIAL" ? (l.replies > 1 ? "convinced" : "interested") : "silent",
        })),
        qualified: leads.filter((l) => l.state === "SANDBOX_TRIAL").map((l) => l.name),
      };
    }

    case "trial": {
      let heroMs = 0;
      const ready = await leadsIn(ws, "SANDBOX_TRIAL");
      for (const l of ready) {
        const t0 = performance.now();
        await advance(ws, l.id);
        if (l.id === HERO) heroMs = performance.now() - t0;
      }
      const hero = (await getLead(ws, HERO))!;
      const t = hero.trial!;
      const c = company(HERO);
      const byId = new Map(t.findings.map((f) => [f.invoiceId, f]));
      const invoices = DATA.trial.invoices
        .filter((i) => c.suppliers.includes(i.supplierId) && i.currency === c.currency)
        .map((i) => {
          const f = byId.get(i.id);
          return {
            number: i.number,
            supplier: DATA.suppliers.find((s) => s.id === i.supplierId)?.name ?? i.supplierId,
            amount: f ? fmtShort(f.billed, c.currency) : null,
            viaAI: !!i.raw,
            status: !f ? "review" : f.flags.length ? "flagged" : "clean",
            labels: f ? f.flags.map((x) => FLAG_LABEL[x]) : [],
          };
        });
      return {
        trialsRun: ready.length,
        hero: { name: hero.name, contact: `${hero.contact_name}, ${hero.contact_role}`, industry: hero.industry },
        invoices,
        flagged: t.flagged,
        reviewed: t.reviewed.length,
        caught: fmtShort(t.leakage, c.currency),
        agentSeconds: Math.max(0.1, heroMs / 1000).toFixed(1),
      };
    }

    case "book": {
      for (const l of await leadsIn(ws, "SANDBOX_TRIAL")) await advance(ws, l.id);
      const hero = (await getLead(ws, HERO))!;
      const t = hero.trial!;
      const c = company(HERO);
      const locked = await leadsIn(ws, "PRE_SALE_HOLD");
      const waiting = await leadsIn(ws, "SANDBOX_TRIAL");
      return {
        locked: locked.map((l) => l.name),
        waiting: waiting.map((l) => l.name),
        hero: {
          id: hero.id,
          name: hero.name,
          state: hero.state,
          callAt: hero.call_at,
          erp: c.erp,
          currency: c.currency,
          invoiceCount: t.invoiceCount,
          manualHours: ((t.invoiceCount * t.roi.assumptions.minutesPerInvoice) / 60).toFixed(1),
          wouldHavePaid: fmtShort(t.leakage, c.currency),
          protectedPerMonth: fmtShort(t.roi.protectedPerMonth, c.currency),
          monthlySpend: fmtShort(c.monthlyApSpend, c.currency),
          errorRate: `${t.roi.assumptions.errorRateBp / 100}%`,
          hoursPerMonth: (t.roi.hoursSavedPerMonth10 / 10).toFixed(0),
          workingCapital: fmtShort(t.roi.workingCapitalFreed, c.currency),
          dsoDays: t.roi.assumptions.dsoReductionDays,
          dealValue: DEMO_DEAL_VALUE[c.currency],
          dealValueLabel: fmtShort(DEMO_DEAL_VALUE[c.currency], c.currency),
        },
      };
    }
  }
}
