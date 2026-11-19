"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "../TopBar";

type BatchInfo = { id: string; title: string; region: string; buyer: string; docs: string[]; note: string };
type ReadBy = "template" | "ai-text" | "ai-vision" | "none";
type Read = { id: string; status: "read" | "review"; readBy: ReadBy; model?: string; cached?: boolean; scan: boolean; reason?: string; note?: string; ms: number; supplier?: string; number?: string };
type Fields = Record<string, unknown> & { lines?: Record<string, string>[]; charges?: { label: string; amount: string }[] };
type Doc = Read & { fields?: Fields; amount?: string; flags: string[]; labels: string[]; atRisk?: string; confirm: boolean };
type Report = {
  docs: Doc[];
  summary: { total: number; read: number; review: number; flagged: number; byAI: number; byTemplate: number; atRisk: string; seconds: string; manualHours: string; byCheck: Record<string, number> };
  roi?: { monthlySpend: string; protectedPerMonth: string; hoursPerMonth: string; errorRate: string };
  buyer?: string; currency?: "INR" | "USD"; names?: Record<string, string>;
};
type Status = { provider: "groq" | "anthropic" | null; textModel: string | null; scanModel: string | null };
type Source = { kind: "batch"; batch: BatchInfo } | { kind: "upload"; count: number };

const CHECKS: [string, string, "po" | "gst" | "all"][] = [
  ["DUPLICATE_INVOICE", "Not billed before", "all"],
  ["PRICE_MISMATCH", "Price matches the purchase order", "po"],
  ["QTY_MISMATCH", "Quantity matches goods received", "po"],
  ["UNAUTHORIZED_CHARGE", "Every charge is on the purchase order", "po"],
  ["GST_RATE_WRONG", "GST rate matches the HSN code", "gst"],
  ["WRONG_TAX_TYPE", "Tax type matches the place of supply", "gst"],
  ["INVALID_GSTIN", "Supplier GST number is valid", "gst"],
  ["TAX_MATH_ERROR", "Tax amounts add up", "all"],
  ["TOTAL_MISMATCH", "Total and round-off add up", "all"],
  ["WORDS_MISMATCH", "Amount in words matches the total", "all"],
];

const howRead = (r: Pick<Read, "readBy" | "model" | "cached" | "note">) =>
  r.readBy === "template" ? (r.note ? "Read by code · AI was busy" : "Read by code (known layout)")
  : r.readBy === "ai-text" ? `Read by AI · ${r.model}${r.cached ? " · cached" : ""}`
  : r.readBy === "ai-vision" ? `Scan read by AI · ${r.model}${r.cached ? " · cached" : ""}`
  : "Not read";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export default function Prototype({ batches }: { batches: BatchInfo[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"choose" | "reading" | "reconciling" | "results" | "error">("choose");
  const [source, setSource] = useState<Source | null>(null);
  const [reads, setReads] = useState<Record<string, Read | "busy">>({});
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Doc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetch("/api/prototype/status").then((r) => r.json()).then(setStatus).catch(() => {}); }, []);

  async function runBatch(b: BatchInfo) {
    setSource({ kind: "batch", batch: b });
    setReads({});
    setPhase("reading");
    window.scrollTo({ top: 0 });
    try {
      let next = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (next < b.docs.length) {
          const id = b.docs[next++];
          setReads((r) => ({ ...r, [id]: "busy" }));
          const res = (await post("/api/prototype/read", { batch: b.id, id })) as Read;
          setReads((r) => ({ ...r, [id]: res }));
        }
      }));
      setPhase("reconciling");
      setReport(await post("/api/prototype/reconcile", { batch: b.id }));
      setPhase("results");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function runUpload(files: FileList | null) {
    if (!files?.length) return;
    if (files.length > 5) { setError("Choose up to 5 PDFs."); setPhase("error"); return; }
    setSource({ kind: "upload", count: files.length });
    setPhase("reconciling");
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    try {
      const res = await fetch("/api/prototype/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setReport(data);
      setPhase("results");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const ai = status?.provider;
  const chip = (
    <span className={`aichip ${ai ? "" : "off"}`}>
      <i />
      {status === null ? "Checking AI…" : ai
        ? `AI reader on · ${ai === "groq" ? "Groq" : "Claude"} · ${status.textModel}${status.scanModel !== status.textModel ? ` (scans: ${status.scanModel})` : ""}`
        : "AI reader off · known layouts are read by code, scans go to a person"}
    </span>
  );

  return (
    <div className="proto">
      <TopBar><span>Working prototype</span><Link href="/run">Simulated demo →</Link></TopBar>
      <div className="wrap">
        {phase === "choose" && (
          <>
            <div className="eyebrow">Working prototype · invoice engine</div>
            <h1>Real invoices in. <span className="gold">Checked numbers out.</span></h1>
            <p className="lede">
              Real PDF tax invoices, including photocopied scans, are read by AI. Then code checks every number against the buyer&apos;s own
              purchase orders and goods receipts. The companies are fictional; the documents, rules and maths are real.
            </p>
            {chip}
            <div className="sources">
              {batches.map((b) => (
                <div key={b.id} className="panel source">
                  <div className="eyebrow">{b.region}</div>
                  <h3>{b.title}</h3>
                  <div className="num">{b.docs.length} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>invoice PDFs</span></div>
                  <div className="meta">{b.note} · with their purchase-order and goods-receipt exports</div>
                  <button className="btn gold" onClick={() => runBatch(b)}>Process this batch →</button>
                </div>
              ))}
              <div className="panel source">
                <div className="eyebrow">Your own</div>
                <h3>Upload invoices</h3>
                <div className="meta">Up to 5 PDF invoices, 2 MB each. Checks the document itself: GST number, tax type, maths, amount in words, duplicates. Files are not stored.</div>
                <label className="drop">
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple onChange={(e) => runUpload(e.target.files)} />
                  Choose PDF files
                </label>
                <a className="small" href={`/api/prototype/doc/kaveri/${batches[0].docs[1]}`} target="_blank" rel="noreferrer">See a sample invoice ↗</a>
              </div>
            </div>
          </>
        )}

        {(phase === "reading" || phase === "reconciling") && (
          <>
            <div className="eyebrow">{phase === "reading" ? "Reading documents" : "Reconciling"}</div>
            <h1>
              {source?.kind === "batch"
                ? `${Object.values(reads).filter((r) => r !== "busy").length} of ${source.batch.docs.length} invoices read`
                : `Reading ${source?.count} uploaded invoice${source?.count === 1 ? "" : "s"}…`}
            </h1>
            <p className="lede">
              {phase === "reading"
                ? "Each PDF: the text layer is pulled out by code, the AI copies the values exactly as printed, and code confirms every value is on the page."
                : "Matching every line to its purchase order and goods receipt, and re-calculating GST, totals and the amount in words…"}
            </p>
            {chip}
            {source?.kind === "batch" && (
              <div className="docgrid">
                {source.batch.docs.map((id) => {
                  const r = reads[id];
                  if (!r) return <div key={id} className="doc wait"><b>{id}</b>waiting</div>;
                  if (r === "busy") return <div key={id} className="doc busy"><b>{id}</b></div>;
                  return (
                    <div key={id} className={`doc in ${r.status}`}>
                      <b>{r.number ?? id}</b>
                      <div>{r.supplier ?? (r.scan ? "Scanned invoice" : "")}</div>
                      <div className="how">{r.status === "review" ? "Needs a person" : `${r.readBy === "template" ? "Code" : r.scan ? "Scan · AI" : "AI"} · ${(r.ms / 1000).toFixed(1)} s`}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {phase === "reconciling" && <div className="spinner" />}
          </>
        )}

        {phase === "results" && report && <Results report={report} source={source!} onOpen={setOpen} onAgain={() => { setPhase("choose"); setReport(null); }} />}

        {phase === "error" && (
          <div className="panel done-card" style={{ maxWidth: 620, margin: "60px auto" }}>
            <div className="eyebrow">Stopped</div>
            <h2>{error}</h2>
            <div className="row"><button className="btn gold" onClick={() => setPhase("choose")}>Back</button></div>
          </div>
        )}
      </div>

      {open && <Evidence doc={open} source={source!} name={report?.names?.[open.id]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Results({ report, source, onOpen, onAgain }: { report: Report; source: Source; onOpen: (d: Doc) => void; onAgain: () => void }) {
  const s = report.summary;
  const max = Math.max(1, ...Object.values(s.byCheck));
  const docs = [...report.docs].sort((a, b) => Number(b.flags.length > 0) - Number(a.flags.length > 0) || Number(b.status === "review") - Number(a.status === "review"));
  return (
    <>
      <div className="eyebrow">Result</div>
      <h1>{source.kind === "batch" ? <>{s.total} invoices for <span className="gold">{source.batch.title}</span></> : <>Your {s.total} invoice{s.total === 1 ? "" : "s"}</>}</h1>
      <p className="lede">
        {s.read} read ({s.byAI} by AI, {s.byTemplate} by code) and checked in {s.seconds} s of processing, against about {s.manualHours} hours by hand.
        {s.review ? ` ${s.review} couldn't be read with certainty and went to a person.` : ""}
      </p>
      <div className="stats">
        <div className="panel stat2 gold in"><b>{s.flagged}</b><span>invoices with a problem</span></div>
        <div className="panel stat2 gold in" style={{ animationDelay: "100ms" }}><b>{s.atRisk}</b><span>billed above what's owed</span></div>
        <div className="panel stat2 in" style={{ animationDelay: "200ms" }}><b>{s.read}</b><span>read and fully checked</span></div>
        <div className="panel stat2 in" style={{ animationDelay: "300ms" }}><b>{s.review}</b><span>handed to a person</span></div>
      </div>
      <div className="split2">
        <div className="panel checks2">
          <h3>What was caught</h3>
          {Object.keys(s.byCheck).length === 0 && <p className="muted small">No problems found.</p>}
          {Object.entries(s.byCheck).sort((a, b) => b[1] - a[1]).map(([label, n]) => (
            <div key={label} className="cbar"><div>{label}<div className="t"><i style={{ width: `${(n / max) * 100}%` }} /></div></div><b>{n}</b></div>
          ))}
          {source.kind === "upload" && <p className="small muted" style={{ marginTop: 12 }}>Uploads have no purchase orders to match, so only document checks ran.</p>}
        </div>
        <div className="panel invtable scroll">
          <table>
            <thead><tr><th>Invoice</th><th>Amount</th><th>How it was read</th><th>Result</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} onClick={() => onOpen(d)}>
                  <td><b>{d.number ?? report.names?.[d.id] ?? d.id}</b><div className="how2">{d.supplier ?? (d.scan ? "Scanned invoice" : "")}</div></td>
                  <td className="mono">{d.amount ?? "—"}</td>
                  <td className="how2">{howRead(d)}</td>
                  <td>
                    {d.status === "review" ? <span className="tag no">Needs a person</span>
                      : d.flags.length ? <span className="tag bad">{d.labels.join(" · ")}{d.confirm ? " · confirm" : ""}</span>
                      : <span className="tag">✓ All checks pass</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {report.roi && (
        <div className="figures">
          <div className="panel figure"><b>{report.roi.protectedPerMonth}</b><span>protected every month*</span><small>{report.roi.errorRate} of {report.roi.monthlySpend} monthly supplier spend</small></div>
          <div className="panel figure"><b>{report.roi.hoursPerMonth} h</b><span>of matching saved each month</span><small>at their invoice volume, 12 min each by hand</small></div>
          <div className="panel figure"><b>{s.atRisk}</b><span>stopped in this batch alone</span><small>held before payment, with the reason</small></div>
        </div>
      )}
      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn gold" onClick={onAgain}>Process another batch</button>
        <Link className="btn" href="/run">Watch the simulated sales demo</Link>
      </div>
      <p className="foot-note">
        Click any invoice to see the original PDF beside what was read and every check. *The sample batch is deliberately error-heavy, so monthly protection uses a
        conservative {report.roi?.errorRate ?? "1%"} error rate. Every amount is computed by code, never by AI.
      </p>
    </>
  );
}

function Evidence({ doc, source, name, onClose }: { doc: Doc; source: Source; name?: string; onClose: () => void }) {
  const gst = (doc.fields?.currency ?? "INR") === "INR";
  const po = source.kind === "batch";
  const f = doc.fields;
  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel drawer">
        {source.kind === "batch"
          ? <iframe title={`Invoice ${doc.id}`} src={`/api/prototype/doc/${source.batch.id}/${doc.id}#toolbar=0&view=FitH`} />
          : <div style={{ display: "grid", placeItems: "center", color: "var(--muted)", padding: 24 }}>Your file isn&apos;t stored, so it can&apos;t be shown here.<br />{name}</div>}
        <div className="side">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="eyebrow">{howRead(doc)}</div>
            <button className="linkbtn" onClick={onClose} aria-label="Close">Close ✕</button>
          </div>
          <h2>{doc.number ?? name ?? doc.id}</h2>
          <div className="muted small">{doc.supplier}{doc.amount ? ` · ${doc.amount}` : ""}{doc.atRisk ? ` · ${doc.atRisk} at risk` : ""}</div>
          {doc.status === "review" && <div className="note">Handed to a person: {doc.reason}</div>}
          {doc.confirm && <div className="note">Read from a scan: a person confirms against the image before anything is held.</div>}
          {doc.status === "read" && (
            <div style={{ marginTop: 12 }}>
              {CHECKS.filter(([, , scope]) => (scope !== "po" || po) && (scope !== "gst" || gst)).map(([flag, label]) => {
                const failed = doc.flags.includes(flag);
                return <div key={flag} className={`ck ${failed ? "no" : "ok"}`}><i>{failed ? "✗" : "✓"}</i>{label}</div>;
              })}
            </div>
          )}
          {f && (
            <table className="fields">
              <tbody>
                {[["Invoice no.", f.invoiceNumber], ["Date", f.invoiceDate], ["PO", f.poNumber], ["Supplier GSTIN", f.supplierGstin], ["Place of supply", f.placeOfSupplyCode],
                  ["CGST", f.cgst], ["SGST", f.sgst], ["IGST", f.igst], ["Round off", f.roundOff], ["Total", f.grandTotal], ["In words", f.amountInWords]]
                  .filter(([, v]) => v).map(([k, v]) => <tr key={String(k)}><td>{String(k)}</td><td className="mono">{String(v)}</td></tr>)}
                {f.lines?.map((l, i) => <tr key={i}><td>Line {i + 1}</td><td className="mono">{l.sku} · {l.qty} × {l.rate} = {l.amount} · {l.gstRate || "no GST"}</td></tr>)}
                {f.charges?.map((c) => <tr key={c.label}><td>Extra charge</td><td className="mono">{c.label} · {c.amount}</td></tr>)}
              </tbody>
            </table>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>Values above are exactly as printed. Code converted them and ran every check.</p>
        </div>
      </div>
    </div>
  );
}
