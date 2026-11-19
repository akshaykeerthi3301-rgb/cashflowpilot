import { notFound } from "next/navigation";
import { getLead } from "@/agents/common";
import { PrintButton } from "../../../ui";
import { pageWs } from "../../../server";

import { NoRun } from "../../../NoRun";
import { TopBar } from "../../../TopBar";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  contact: "Contact", erp: "ERP", invoices: "Invoices in trial", flagged: "Flagged", by_type: "By type",
  leakage: "Overbilled in sample", protected_per_month: "Protected / month (1% error rate)", hours_saved: "Hours saved / month",
  working_capital: "Working capital freed", dso_days: "DSO cut assumed (days)", intent: "Buying intent", questions: "Questions asked",
};

export default async function Brief({ params }: { params: Promise<{ id: string }> }) {
  const ws = await pageWs();
  if (!ws) return <NoRun />;
  const lead = await getLead(ws, (await params).id);
  if (!lead?.brief) notFound();
  const { facts, narrative, source } = lead.brief;
  return (
    <>
      <TopBar />
      <div className="page">
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Pre-call brief: {facts.company}</h1><p className="muted">Call {new Date(lead.call_at!).toUTCString()} · {facts.contact}</p></div>
        <PrintButton />
      </div>
      <h3>Situation</h3><p>{narrative.situation}</p>
      <h3>Numbers (computed by code)</h3>
      <table><tbody>{Object.entries(LABELS).map(([k, label]) => <tr key={k}><td>{label}</td><td className="mono">{facts[k]}</td></tr>)}</tbody></table>
      <h3>Talking points</h3><ul>{narrative.talking_points.map((p) => <li key={p}>{p}</li>)}</ul>
      <h3>Risks</h3><ul>{narrative.risks.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="small muted">Wording by {source === "model" ? "AI model" : "built-in simulator"}; every number in it was checked against the code-computed facts.</p>
    </div>
      </div>
    </>
  );
}
