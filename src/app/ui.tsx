"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body?: unknown, raw = false) {
  const res = await fetch(url, {
    method: "POST",
    headers: raw ? { "content-type": "text/csv" } : { "content-type": "application/json" },
    body: raw ? (body as string) : body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const STOP = new Set(["PRE_SALE_HOLD", "OPTED_OUT", "CLOSED_LOST", "STAGE_A_SHADOW_MODE", "STAGE_B_PRODUCTION_ACTIVE"]);

export function DemoRunner({ ids, hasLeads }: { ids: string[]; hasLeads: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [...l, s]);

  async function run() {
    setBusy(true);
    setLog([]);
    if (!hasLeads) {
      const r = await post("/api/research");
      add(`researcher: scored ${r.data.added ?? 0} fictional companies`);
      router.refresh();
    }
    for (const id of ids) {
      let prev = "", prevDid = "";
      for (let i = 0; i < 8; i++) {
        const r = await post(`/api/leads/${id}/advance`);
        if (r.status !== 200) { add(`${id}: ${r.data.error ?? "error"}`); break; }
        add(`${id}: ${r.data.did}`);
        // Stop when the agent is stuck at a gate: same stage and the same message twice in a row.
        const stuck = r.data.state === prev && r.data.did === prevDid;
        prev = r.data.state;
        prevDid = r.data.did;
        if (stuck || STOP.has(r.data.state)) break;
      }
      router.refresh();
    }
    add("— done. Deals at PRE_SALE_HOLD are waiting for you, the founder.");
    setBusy(false);
  }
  async function reset() {
    setBusy(true);
    await post("/api/reset");
    setLog(["demo reset"]);
    router.refresh();
    setBusy(false);
  }
  return (
    <div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={run}>{busy ? "Agent working…" : "Run full demo"}</button>
        <button disabled={busy} onClick={reset}>Reset demo</button>
      </div>
      {log.length > 0 && <div className="log" style={{ marginTop: 12 }}>{log.join("\n")}</div>}
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(await fn());
    router.refresh();
    setBusy(false);
  };
  return { busy, msg, go };
}

export function StepButton({ id }: { id: string }) {
  const { busy, msg, go } = useAction();
  return (
    <span className="row">
      <button disabled={busy} onClick={() => go(async () => (await post(`/api/leads/${id}/advance`)).data.did ?? "error")}>Advance agent one step</button>
      {msg && <span className="small muted">{msg}</span>}
    </span>
  );
}

export function AgentProvisionButton({ id }: { id: string }) {
  const { busy, msg, go } = useAction();
  return (
    <div>
      <button className="danger" disabled={busy} onClick={() => go(async () => {
        const r = (await post(`/api/leads/${id}/agent-provision`)).data;
        return r.ok ? "Provisioned (this should never happen)" : `Rejected: ${r.reason}`;
      })}>Let the agent try to provision</button>
      {msg && <div className="err">{msg} — logged in the audit trail.</div>}
    </div>
  );
}

export function PromoteButton({ id }: { id: string }) {
  const { busy, msg, go } = useAction();
  return (
    <div>
      <button className="primary" disabled={busy} onClick={() => go(async () => {
        const r = (await post(`/api/leads/${id}/promote`)).data;
        return r.ok ? "Stage B enabled (assisted actions, still behind approvals)." : `Rejected: ${r.reason}`;
      })}>Enable Stage B (founder)</button>
      {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// "1200000.50" -> 120000050 without floating point.
function toMinor(s: string): number | null {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}

const SYSTEMS = ["tally", "zoho_books", "quickbooks", "netsuite", "sap_b1", "csv_upload"];

export function CloseWonForm({ id, currency, erp }: { id: string; currency: "INR" | "USD"; erp: string }) {
  const { busy, go } = useAction();
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({ signed_by: "", deal_value: "", approver: "", notes: "", systems: [SYSTEMS.includes(erp) ? erp : "csv_upload"] });
  const set = (k: string, v: unknown) => { setF({ ...f, [k]: v }); setErrors([]); };

  function submit() {
    const value = toMinor(f.deal_value);
    const local: string[] = [];
    if (f.signed_by.trim().length < 2) local.push("Type your name to sign the directive.");
    if (!value) local.push("Enter the deal value, e.g. 1200000 or 1200000.50.");
    if (!f.systems.length) local.push("Pick at least one system the tenant may read.");
    if (f.approver.trim().length < 2) local.push("Name who approves Stage B.");
    if (local.length) return setErrors(local);
    go(async () => {
      const r = await post(`/api/leads/${id}/close-won`, {
        lead_id: id, signed_by: f.signed_by, signed_at: new Date().toISOString(), deal_value: value, currency,
        scope: "shadow_only", allowed_systems: f.systems, max_auto_amount: 0, approver_for_stage_b: f.approver, notes: f.notes,
      });
      if (r.status !== 200) setErrors(r.data.errors ?? ["failed"]);
      return "";
    });
  }
  return (
    <div>
      <label>Signed by (you, the founder)</label>
      <input type="text" value={f.signed_by} onChange={(e) => set("signed_by", e.target.value)} />
      <label>Deal value ({currency}, annual)</label>
      <input type="text" inputMode="decimal" value={f.deal_value} onChange={(e) => set("deal_value", e.target.value)} placeholder="1200000" />
      <label>Systems the tenant may READ</label>
      <div className="row">
        {SYSTEMS.map((s) => (
          <label key={s} className="row" style={{ margin: 0, gap: 4 }}>
            <input type="checkbox" checked={f.systems.includes(s)} onChange={(e) => set("systems", e.target.checked ? [...f.systems, s] : f.systems.filter((x) => x !== s))} />
            {s}
          </label>
        ))}
      </div>
      <label>Scope (fixed)</label>
      <div className="small">Shadow Mode only · max automatic payment amount: 0</div>
      <label>Who approves Stage B?</label>
      <input type="text" value={f.approver} onChange={(e) => set("approver", e.target.value)} />
      <label>Notes</label>
      <input type="text" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      {errors.map((e) => <div className="err" key={e}>{e}</div>)}
      <div style={{ marginTop: 12 }}>
        <button className="primary" disabled={busy} onClick={submit}>Mark CLOSED_WON and sign Release Directive</button>
      </div>
    </div>
  );
}

export function AskBox({ id }: { id: string }) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const { busy, msg, go } = useAction();
  return (
    <div>
      <label>Ask the trial a question, as the buyer</label>
      <div className="row">
        <input type="text" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => { setQ(e.target.value); setErr(""); }} placeholder="e.g. Is our bank data safe?" />
        <button disabled={busy} onClick={() => {
          if (q.trim().length < 3) return setErr("Type a question first.");
          go(async () => { const r = (await post(`/api/leads/${id}/ask`, { question: q })).data; return r.answer ? `${r.answer} (source: ${r.source}, by ${r.by})` : r.error; });
        }}>Ask</button>
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="mail out">{msg}</div>}
    </div>
  );
}

type UploadResult = { ok: boolean; errors?: string[]; invoices?: { id: string; number: string }[]; findings?: { invoiceId: string; flags: string[] }[] };

export function UploadBox({ id }: { id: string }) {
  const [res, setRes] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setRes((await post(`/api/leads/${id}/upload`, await file.text(), true)).data);
    setBusy(false);
  }
  return (
    <div>
      <label>Upload your own invoice CSV (checks duplicates, GST rates and tax arithmetic)</label>
      <div className="row">
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        <a className="small" href="/sample-upload.csv" download>Download a sample CSV</a>
      </div>
      {res?.errors && res.errors.map((e) => <div className="err" key={e}>{e}</div>)}
      {res?.ok && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            {res.findings!.map((f, i) => (
              <tr key={f.invoiceId}><td>{res.invoices![i].number}</td><td>{f.flags.length ? f.flags.map((x) => <span key={x} className="badge bad">{x}</span>) : <span className="badge ok">clean</span>}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PrintButton() {
  return <button className="noprint" onClick={() => window.print()}>Print / save as PDF</button>;
}
