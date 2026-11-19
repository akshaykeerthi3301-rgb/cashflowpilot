import { query } from "@/db";
import { pageWs } from "../server";

import { NoRun } from "../NoRun";
import { TopBar } from "../TopBar";

export const dynamic = "force-dynamic";

export default async function Audit({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const ws = await pageWs();
  if (!ws) return <NoRun />;
  const { lead } = await searchParams;
  const rows = await query<{ id: number; lead_id: string | null; actor: string; action: string; detail: unknown; created_at: string }>(
    `SELECT id, lead_id, actor, action, detail, created_at FROM audit WHERE workspace_id=$1 ${lead ? "AND lead_id=$2" : ""} ORDER BY id DESC LIMIT 400`,
    lead ? [ws, lead] : [ws],
  );
  return (
    <>
      <TopBar />
      <div className="page">
      <h1>Audit log{lead ? ` — ${lead}` : ""}</h1>
      <p className="muted small">Append-only. Every stage change, rejected attempt, email, and AI call (and whether it came from the model or the simulator).</p>
      <div className="card scroll">
        <table>
          <thead><tr><th>#</th><th>Time (UTC)</th><th>Lead</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td className="mono">{new Date(r.created_at).toISOString().slice(11, 19)}</td>
                <td>{r.lead_id ? <a href={`/audit?lead=${r.lead_id}`}>{r.lead_id}</a> : "—"}</td>
                <td>{r.actor}</td>
                <td><span className={`badge ${r.action.includes("rejected") || r.action.includes("blocked") ? "bad" : r.action === "transition" ? "ok" : ""}`}>{r.action}</span></td>
                <td className="mono">{JSON.stringify(r.detail).slice(0, 160)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
