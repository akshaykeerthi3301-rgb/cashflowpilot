import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/db";
import { DATA, company, fmtMoney, getLead } from "@/agents/common";
import type { ScoreLine } from "@/deterministic/scoring";
import { GATES } from "@/state_machine";
import { AgentProvisionButton, AskBox, CloseWonForm, PromoteButton, StepButton, UploadBox } from "../../ui";
import { Pipeline } from "../../badges";
import { pageWs } from "../../server";

import { NoRun } from "../../NoRun";
import { TopBar } from "../../TopBar";

export const dynamic = "force-dynamic";

const supplierName = (id: string) => DATA.suppliers.find((s) => s.id === id)?.name ?? id;
const invoice = (id: string) => DATA.trial.invoices.find((i) => i.id === id)!;

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await pageWs();
  if (!ws) return <NoRun />;
  const lead = await getLead(ws, (await params).id);
  if (!lead) notFound();
  const c = company(lead.company_id);
  const mails = await query<{ id: number; direction: string; subject: string; body: string }>(
    "SELECT id, direction, subject, body FROM outbox WHERE workspace_id=$1 AND lead_id=$2 ORDER BY id", [ws, lead.id]);
  const review = await query<{ reason: string }>("SELECT reason FROM review_queue WHERE workspace_id=$1 AND lead_id=$2 ORDER BY id", [ws, lead.id]);
  const t = lead.trial, m = (x: number) => fmtMoney(x, c.currency);
  const s = lead.shadow;

  return (
    <>
      <TopBar />
      <div className="page">
      <p className="small noprint"><Link href="/run">← Back to the run</Link> · <Link href="/audit">Full audit trail</Link></p>
      <h1>{lead.name}</h1>
      <p className="muted">{c.industry} · {c.region} · {c.employees} employees · ERP: {c.erp} · {lead.contact_name}, {lead.contact_role}</p>
      <Pipeline state={lead.state} />
      <div className="row noprint"><StepButton id={lead.id} /><Link className="small" href={`/audit?lead=${lead.id}`}>Audit trail for this lead →</Link></div>

      <div className="grid">
        <div className="card">
          <h2>Fit score: {lead.score}/100</h2>
          <p className="small muted">Computed by code. Outreach needs ≥ {GATES.outreachMinScore}.</p>
          <table><tbody>
            {((lead.score_breakdown ?? []) as ScoreLine[]).map((l) => (
              <tr key={l.factor}><td>{l.factor}<div className="small muted">{l.why}</div></td><td className="mono">{l.points}/{l.max}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h2>Mail thread</h2>
          <p className="small muted">Simulated outbox — nothing leaves this demo.</p>
          {mails.length === 0 && <p className="small muted">No messages yet.</p>}
          {mails.map((x) => (
            <div key={x.id} className={`mail ${x.direction}`}>
              <div className="small muted">{x.direction === "out" ? "Agent → buyer" : "Buyer → agent"} · <b>{x.subject}</b></div>
              {x.body}
            </div>
          ))}
        </div>
      </div>

      {t && (
        <div className="card">
          <h2>Sandbox trial</h2>
          <p>{t.pitch}</p>
          <div className="grid">
            <div className="stat">Issues flagged<b>{t.flagged} of {t.invoiceCount}</b></div>
            <div className="stat">Overbilled in sample<b>{m(t.leakage)}</b></div>
            <div className="stat">Protected / month*<b>{m(t.roi.protectedPerMonth)}</b></div>
            <div className="stat">Hours saved / month<b>{(t.roi.hoursSavedPerMonth10 / 10).toFixed(1)}</b></div>
            <div className="stat">Working capital freed<b>{m(t.roi.workingCapitalFreed)}</b></div>
            <div className="stat">Buying intent<b>{lead.intent}/100</b><span className="small muted">deal prep needs ≥ {GATES.dealPrepMinIntent}</span></div>
          </div>
          <p className="small muted">
            Assumptions (editable in code): {t.roi.assumptions.minutesPerInvoice} min manual matching per invoice; {t.roi.assumptions.dsoReductionDays}-day DSO cut;
            {" "}{c.monthlyInvoices} invoices/month; *protection assumes a conservative {t.roi.assumptions.errorRateBp / 100}% error rate on monthly spend of {m(c.monthlyApSpend)} (the demo sample is deliberately error-heavy).
            {t.reviewed.length > 0 && <> {t.reviewed.length} unreadable invoice(s) sent to human review: {t.reviewed.join(", ")}.</>}
          </p>
          <div className="scroll">
            <table>
              <thead><tr><th>Invoice</th><th>Supplier</th><th>Billed</th><th>Should be</th><th>Findings</th></tr></thead>
              <tbody>
                {t.findings.map((f) => {
                  const inv = invoice(f.invoiceId);
                  return (
                    <tr key={f.invoiceId}>
                      <td className="mono">{inv.number}{inv.raw && <div className="small muted">read by AI from text</div>}</td>
                      <td>{supplierName(inv.supplierId)}</td>
                      <td className="mono">{m(f.billed)}</td>
                      <td className="mono">{m(f.expectedTotal)}</td>
                      <td>{f.flags.length ? f.flags.map((x) => <span key={x} className="badge bad" style={{ marginRight: 4 }}>{x}</span>) : <span className="badge ok">clean</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {t.qa.map((x) => <div key={x.q} className="mail in"><b>Buyer asked:</b> {x.q}<br /><b>Agent:</b> {x.a} <span className="small muted">({x.source})</span></div>)}
          <div className="grid noprint" style={{ marginTop: 12 }}><AskBox id={lead.id} /><UploadBox id={lead.id} /></div>
        </div>
      )}

      {lead.brief && (
        <div className="card">
          <h2>Pre-call brief</h2>
          <p>{lead.brief.narrative.situation}</p>
          <p className="small">Call: <b>{new Date(lead.call_at!).toUTCString()}</b> · <a href={`/api/leads/${lead.id}/ics`}>Download calendar invite (.ics)</a> · <Link href={`/leads/${lead.id}/brief`}>Open the 1-page brief</Link></p>
        </div>
      )}

      {(lead.state === "PRE_SALE_HOLD" || lead.deal_status) && (
        <div className="card">
          <h2>Deal room</h2>
          {lead.state === "PRE_SALE_HOLD" ? (
            <>
              <div className="lockbox"><b>PRE_SALE_HOLD.</b> The agent cannot provision this customer. Only you, the founder, can mark the deal won and sign a Release Directive.</div>
              <div className="grid" style={{ marginTop: 16 }}>
                <div><h3>Try to break the lock</h3><p className="small muted">Ask the agent to provision on its own. The server refuses and logs it.</p><AgentProvisionButton id={lead.id} /></div>
                <div><h3>You are the founder</h3><CloseWonForm id={lead.id} currency={c.currency} erp={c.erp} /></div>
              </div>
            </>
          ) : <p><span className="badge ok">CLOSED_WON</span> Release Directive signed. Tenant provisioned read-only.</p>}
        </div>
      )}

      {s && (
        <div className="card">
          <h2>Shadow mode scorecard</h2>
          <p className="small muted">The tenant only reads. The agent's decisions on 60 held-out invoices are compared to the answer key (in real life: your AP team's own decisions).</p>
          <div className="grid">
            <div className="stat">Accuracy<b>{(s.accuracyBp / 100).toFixed(2)}%</b></div>
            <div className="stat">Decided<b>{s.decided}</b></div>
            <div className="stat">Sent to human review<b>{s.reviewed}</b></div>
            <div className="stat">Stage B gate<b>{s.decided >= GATES.stageBMinDecided && s.accuracyBp >= GATES.stageBMinAccuracyBp ? "Met" : "Not met"}</b><span className="small muted">≥{GATES.stageBMinAccuracyBp / 100}% over ≥{GATES.stageBMinDecided}</span></div>
          </div>
          <div className="scroll"><table style={{ marginTop: 12 }}>
            <thead><tr><th>Check</th><th>Caught</th><th>False alarms</th><th>Missed</th></tr></thead>
            <tbody>{s.perFlag.map((p) => <tr key={p.flag}><td className="mono">{p.flag}</td><td>{p.tp}</td><td>{p.fp}</td><td>{p.fn}</td></tr>)}</tbody>
          </table></div>
          {lead.state === "STAGE_A_SHADOW_MODE" && <div style={{ marginTop: 12 }}><PromoteButton id={lead.id} /></div>}
          {lead.state === "STAGE_B_PRODUCTION_ACTIVE" && <p><span className="badge ok">Stage B active</span> Assisted actions (dispute drafts, payment holds) — each still needs a human approval.</p>}
        </div>
      )}

      {review.length > 0 && (
        <div className="card"><h2>Needs a human</h2><ul className="small">{review.map((r, i) => <li key={i}>{r.reason}</li>)}</ul></div>
      )}
      </div>
    </>
  );
}
