"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "../TopBar";

// ---- shapes returned by /api/run/stage (all money already formatted by the server) ----
type Research = { hero: { name: string; contact: string }; threshold: number; companies: { name: string; industry: string; region: string; score: number; fit: boolean }[] };
type Outreach = { emails: { company: string; to: string }[]; skipped: number; sample?: { subject: string; body: string } };
type Outcome = "interested" | "convinced" | "unsubscribed" | "silent";
type Replies = { replies: { company: string; contact: string; text: string | null; outcome: Outcome }[]; qualified: string[] };
type Inv = { number: string; supplier: string; amount: string | null; viaAI: boolean; status: "clean" | "flagged" | "review"; labels: string[] };
type Trial = { trialsRun: number; hero: { name: string; contact: string; industry: string }; invoices: Inv[]; flagged: number; reviewed: number; caught: string; agentSeconds: string };
type Hero = {
  id: string; name: string; state: string; callAt: string; erp: string; currency: "INR" | "USD"; invoiceCount: number;
  manualHours: string; wouldHavePaid: string; protectedPerMonth: string; monthlySpend: string; errorRate: string;
  hoursPerMonth: string; workingCapital: string; dsoDays: number; dealValue: number; dealValueLabel: string;
};
type Book = { locked: string[]; waiting: string[]; hero: Hero };
type Data = { research?: Research; outreach?: Outreach; replies?: Replies; trial?: Trial; book?: Book };
type Shadow = { decided: number; accuracyBp: number; reviewed: number };
type Phase = "running" | "reveal" | "onboarding" | "error";

const STEPS = [
  { key: "research", group: "Finding the customer", title: "Research", api: "research", hold: 3800 },
  { key: "outreach", title: "Outreach", api: "outreach", hold: 3800 },
  { key: "replies", title: "Replies", api: "replies", hold: 4800 },
  { key: "qualify", title: "Qualified", hold: 3400 },
  { key: "sandbox", group: "The product at work", title: "Sandbox trial", api: "trial", hold: 3400 },
  { key: "invoices", title: "Invoices received", hold: 3800 },
  { key: "reconcile", title: "Reconciliation", hold: 0 },
  { key: "roi", title: "Impact", api: "book", hold: 2200 },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
const ROW_MS = 190;

const INDUSTRY: Record<string, string> = { saas: "B2B SaaS", d2c: "D2C retail", logistics: "Logistics", manufacturing: "Manufacturing", consulting: "Consulting" };
const ERP: Record<string, string> = { tally: "Tally", zoho_books: "Zoho Books", quickbooks: "QuickBooks", netsuite: "NetSuite", sap_b1: "SAP Business One" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("");

class StageError extends Error {}
async function callStage(stage: string) {
  const res = await fetch("/api/run/stage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) });
  if (res.status === 429) throw new StageError("expired");
  if (!res.ok) throw new StageError("failed");
  return res.json();
}

export default function RunExperience() {
  const [phase, setPhase] = useState<Phase>("running");
  const [cur, setCur] = useState(0);
  const [data, setData] = useState<Data>({});
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<"expired" | "failed">("failed");
  const [approving, setApproving] = useState(false);
  const [onboard, setOnboard] = useState<{ name: string; shadow: Shadow } | null>(null);
  const started = useRef(false);
  const skip = useRef(false);
  const wake = useRef<() => void>(() => {});

  const sleep = (ms: number) =>
    skip.current || ms <= 0 ? Promise.resolve() : new Promise<void>((r) => { const t = setTimeout(r, ms); wake.current = () => { clearTimeout(t); r(); }; });

  useEffect(() => {
    if (started.current) return; // React dev mode runs effects twice; one run only
    started.current = true;
    (async () => {
      const got: Data = {};
      try {
        for (let i = 0; i < STEPS.length; i++) {
          const s = STEPS[i];
          setCur(i);
          const t0 = performance.now();
          if ("api" in s) {
            (got as Record<string, unknown>)[s.api] = await callStage(s.api);
            setData({ ...got });
          }
          const hold = s.key === "reconcile" ? got.trial!.invoices.length * ROW_MS + 1400 : s.hold;
          await sleep(hold - (performance.now() - t0));
        }
        setCur(STEPS.length);
        setPhase("reveal");
      } catch (e) {
        setError(e instanceof StageError && e.message === "expired" ? "expired" : "failed");
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const status =
    phase === "running" ? (
      <>
        <span className="status"><span className="pulse" />Agent running · {mmss(secs)}</span>
        <button className="linkbtn" onClick={() => { skip.current = true; wake.current(); }}>Skip to results →</button>
      </>
    ) : phase === "error" ? <span className="status">Stopped</span> : <span className="status ok"><span className="pulse" />Run complete · {mmss(secs)}</span>;

  return (
    <div className="run">
      <TopBar>{status}</TopBar>
      {phase === "running" && (
        <div className="stage">
          <Steps cur={cur} data={data} />
          <div className="panel detail" key={STEPS[cur]?.key}>
            <Detail step={STEPS[Math.min(cur, STEPS.length - 1)].key} data={data} />
          </div>
        </div>
      )}
      {phase === "reveal" && data.book && data.trial && (
        <Reveal book={data.book} trial={data.trial} onApprove={() => setApproving(true)} />
      )}
      {phase === "onboarding" && onboard && data.book && <Onboarding hero={data.book.hero} name={onboard.name} shadow={onboard.shadow} secs={secs} />}
      {phase === "error" && (
        <div className="onb">
          <div className="panel done-card">
            <div className="eyebrow">{error === "expired" ? "Daily limit reached" : "Something went wrong"}</div>
            <h2>{error === "expired" ? "This demo has been run a lot today." : "The run stopped before finishing."}</h2>
            <p className="muted">Nothing was lost — every run starts fresh.</p>
            <div className="row"><a className="btn gold" href="/run">Start again</a></div>
          </div>
        </div>
      )}
      {approving && data.book && (
        <ApproveModal
          hero={data.book.hero}
          onCancel={() => setApproving(false)}
          onDone={(name, shadow) => { setApproving(false); setOnboard({ name, shadow }); setPhase("onboarding"); window.scrollTo({ top: 0 }); }}
        />
      )}
    </div>
  );
}

// ---------------- left: step list ----------------
function stepSub(key: StepKey, d: Data): string {
  switch (key) {
    case "research": return d.research ? `${d.research.companies.length} scored · ${d.research.companies.filter((c) => c.fit).length} good fits` : "";
    case "outreach": return d.outreach ? `${d.outreach.emails.length} emails sent` : "";
    case "replies": return d.replies ? `${d.replies.replies.filter((r) => r.outcome !== "silent").length} replied` : "";
    case "qualify": return d.replies ? `${d.replies.qualified.length} said yes to a trial` : "";
    case "sandbox": return d.trial ? d.trial.hero.name : "";
    case "invoices": return d.trial ? `${d.trial.invoices.length} received` : "";
    case "reconcile": return d.trial ? `${d.trial.flagged} problems caught` : "";
    case "roi": return d.book ? "Ready for your decision" : "";
  }
}

function Steps({ cur, data }: { cur: number; data: Data }) {
  return (
    <nav className="panel steps" aria-label="Agent progress">
      {STEPS.map((s, i) => {
        const state = i < cur ? "done" : i === cur ? "now" : "wait";
        return (
          <div key={s.key}>
            {"group" in s && <div className="grp">{s.group}</div>}
            <div className={`step ${state} ${i === STEPS.length - 1 || i === 3 ? "last" : ""}`} aria-current={state === "now" ? "step" : undefined}>
              <div className="d">{state === "done" ? "✓" : i + 1}</div>
              <div><b>{s.title}</b><span>{state === "done" ? stepSub(s.key, data) : state === "now" ? "working…" : ""}</span></div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// ---------------- right: what the agent is doing now ----------------
const delay = (ms: number) => ({ animationDelay: `${ms}ms` });
const Waiting = ({ text }: { text: string }) => <><div className="spinner" /><p className="muted" style={{ textAlign: "center" }}>{text}</p></>;

function Detail({ step, data: d }: { step: StepKey; data: Data }) {
  const heroName = d.research?.hero.name ?? "";
  switch (step) {
    case "research":
      return (
        <>
          <div className="eyebrow">Step 1 · Research</div>
          <h2>Scoring {d.research?.companies.length ?? 12} finance teams</h2>
          <p className="sub">Fit is calculated by code from industry, size, region, accounting software, and hiring or funding news the AI read. Only {d.research?.threshold ?? 60}+ gets an email.</p>
          {!d.research ? <Waiting text="Reading company news…" /> : (
            <div className="chips">
              {d.research.companies.map((c, i) => (
                <div key={c.name} className={`chip in ${c.fit ? "" : "off"}`} style={delay(i * 110)}>
                  <div><b>{c.name}</b><small>{INDUSTRY[c.industry] ?? c.industry} · {c.region}</small></div>
                  <div className="score" title="Fit score out of 100">{c.score}</div>
                </div>
              ))}
            </div>
          )}
        </>
      );
    case "outreach":
      return (
        <>
          <div className="eyebrow">Step 2 · Outreach</div>
          <h2>Writing to the people who own the problem</h2>
          {!d.outreach ? <Waiting text="Drafting personal emails…" /> : (
            <>
              <p className="sub">{d.outreach.emails.length} personal emails · {d.outreach.skipped} low-fit companies left alone · in this demo nothing is actually sent.</p>
              <div className="list">
                {d.outreach.emails.slice(0, 6).map((e, i) => (
                  <div key={e.company} className="li in" style={delay(i * 160)}>
                    <div className="who">{e.company}<small>To {e.to}</small></div><span className="tag">Sent</span>
                  </div>
                ))}
              </div>
              {d.outreach.sample && <div className="email in" style={delay(900)}><b>{d.outreach.sample.subject}</b>{d.outreach.sample.body}</div>}
            </>
          )}
        </>
      );
    case "replies": {
      const TAG: Record<Outcome, [string, string]> = {
        interested: ["", "Wants a trial"],
        convinced: ["", "Asked about security · answered · wants a trial"],
        unsubscribed: ["bad", "Unsubscribed · never emailed again"],
        silent: ["no", "No reply · no spam follow-ups"],
      };
      return (
        <>
          <div className="eyebrow">Step 3 · Replies</div>
          <h2>Reading the replies</h2>
          <p className="sub">Questions are answered only from approved documents. Anyone who says stop is never contacted again.</p>
          {!d.replies ? <Waiting text="Waiting for replies…" /> : (
            <div className="list">
              {d.replies.replies.map((r, i) => (
                <div key={r.company} className="li in" style={delay(i * 230)}>
                  <div className="who">{r.company}{r.text && <div className="quote">“{r.text}”</div>}</div>
                  <span className={`tag ${TAG[r.outcome][0]}`}>{TAG[r.outcome][1]}</span>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }
    case "qualify":
      return (
        <>
          <div className="eyebrow">Step 4 · Qualified</div>
          <div className="big in">{d.replies?.qualified.length}</div>
          <h2 className="in" style={delay(150)}>companies said yes to a free, no-risk trial</h2>
          <div className="row in" style={{ ...delay(300), marginTop: 12 }}>{d.replies?.qualified.map((q) => <span key={q} className="tag">{q}</span>)}</div>
          <div className="hero-co in" style={delay(700)}>
            <div className="avatar">{initials(heroName)}</div>
            <div><b>Following {heroName} from here</b><div className="muted small">{d.research?.hero.contact}</div></div>
          </div>
        </>
      );
    case "sandbox":
      return (
        <>
          <div className="eyebrow">Step 5 · Sandbox trial</div>
          <h2>Opening a private sandbox for {heroName}</h2>
          <p className="sub">{d.trial ? `${d.trial.trialsRun} trials opened in total. ` : ""}The buyer tries the real product without giving anything away.</p>
          <div className="checks">
            {["Invoices shaped like their own suppliers", "No access to their accounting software, bank or payments", "Deleted automatically after 24 hours"].map((c, i) => (
              <div key={c} className="in" style={delay(250 + i * 350)}><i>✓</i>{c}</div>
            ))}
          </div>
        </>
      );
    case "invoices": {
      const t = d.trial!;
      return (
        <>
          <div className="eyebrow">Step 6 · Invoices received</div>
          <h2>{t.invoices.length} invoices from {t.hero.name}</h2>
          <p className="sub">{t.invoices.filter((x) => x.viaAI).length} arrived as scanned text, so the AI reads them. If anything is unclear, it goes to a person instead of being guessed.</p>
          <div className="tiles">
            {t.invoices.map((x, i) => (
              <div key={x.number + i} className="tile in" style={delay(i * 70)}>
                <b>{x.number}</b>{x.supplier}<div className={x.viaAI ? "ai" : ""}>{x.viaAI ? "Scanned text · read by AI" : x.amount}</div>
              </div>
            ))}
          </div>
        </>
      );
    }
    case "reconcile": {
      const t = d.trial!;
      return (
        <>
          <div className="eyebrow">Step 7 · Reconciliation</div>
          <h2>Checking every invoice against its order and delivery</h2>
          <p className="sub">Each line is matched to the purchase order and the goods receipt, and the GST is recalculated to the paisa. This is plain code, not AI.</p>
          <div className="progress"><i style={{ animationDuration: `${t.invoices.length * ROW_MS}ms` }} /></div>
          <div className="recon">
            {t.invoices.map((x, i) => (
              <div key={x.number + i} className={`rrow in ${x.status === "flagged" ? "flagged" : ""}`} style={delay(i * ROW_MS)}>
                <span className="num">{x.number}</span>
                <span className="sup muted">{x.supplier}</span>
                <span className="amt">{x.amount ?? "—"}</span>
                <span className="res"><span style={delay(i * ROW_MS + 140)} className={`tag ${x.status === "flagged" ? "bad" : x.status === "review" ? "no" : ""}`}>
                  {x.status === "clean" ? "✓ Matches" : x.status === "review" ? "Unclear → a person" : x.labels.join(" · ")}
                </span></span>
              </div>
            ))}
          </div>
        </>
      );
    }
    case "roi":
      return (
        <>
          <div className="eyebrow">Step 8 · Impact</div>
          <h2>Working out what this means for {heroName}</h2>
          <Waiting text="Calculating the savings, writing the call brief and booking the call…" />
        </>
      );
  }
}

// ---------------- the reveal ----------------
function Reveal({ book, trial, onApprove }: { book: Book; trial: Trial; onApprove: () => void }) {
  const h = book.hero;
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), 80); return () => clearTimeout(t); }, []);
  const call = new Date(h.callAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const zero = h.currency === "INR" ? "₹0" : "$0";
  const bar = (cls: string, pct: number, v: string, l: string) => (
    <div className={`bar ${cls}`}><div className="fill" style={{ height: grown ? `${pct}%` : 0 }} /><div className="v">{v}</div><div className="l">{l}</div></div>
  );
  return (
    <div className="reveal">
      <div className="eyebrow in">Trial result</div>
      <h1 className="in" style={delay(100)}>What changed for <span className="gold">{h.name}</span></h1>
      <p className="sub in" style={delay(200)}>
        {h.invoiceCount} invoices from their suppliers, checked against purchase orders and goods receipts in {trial.agentSeconds} seconds.
      </p>
      <div className="compare">
        <div className="panel in" style={delay(300)}>
          <h3>Time to check this batch</h3>
          <div className="bars">{bar("", 100, `${h.manualHours} h`, "by hand")}{bar("gold", 2, `${trial.agentSeconds} s`, "CashFlowPilot")}</div>
        </div>
        <div className="panel in" style={delay(450)}>
          <h3>Money that would have gone out the door</h3>
          <div className="bars">{bar("red", 100, h.wouldHavePaid, "would have been paid")}{bar("gold", 2, zero, `paid · ${trial.flagged} invoices held`)}</div>
        </div>
      </div>
      <div className="figures">
        <div className="panel figure in" style={delay(700)}><b>{h.protectedPerMonth}</b><span>protected every month*</span><small>{h.errorRate} of {h.monthlySpend} monthly supplier spend</small></div>
        <div className="panel figure in" style={delay(850)}><b>{h.hoursPerMonth} h</b><span>back to the finance team each month</span><small>at their invoice volume</small></div>
        <div className="panel figure in" style={delay(1000)}><b>{h.workingCapital}</b><span>cash freed up</span><small>if customers pay {h.dsoDays} days faster</small></div>
      </div>
      <div className="panel decide in" style={delay(1250)}>
        <p>
          <b>The agent booked a call for {call} IST and stopped.</b> It cannot onboard {h.name} until you approve.
          <span className="muted small" style={{ display: "block", marginTop: 4 }}>
            {book.locked.length} deals are waiting for approval · {book.waiting.length} companies are still exploring their trial
          </span>
        </p>
        <div className="row">
          <Link className="btn" href={`/leads/${h.id}/brief`}>Pre-call brief</Link>
          <button className="btn gold" onClick={onApprove}>Approve the deal →</button>
        </div>
      </div>
      <p className="foot-note">*Demo invoices are deliberately error-heavy, so monthly protection uses a conservative {h.errorRate} error rate instead. Every figure on this page is calculated by code, not AI.</p>
    </div>
  );
}

// ---------------- the founder's decision ----------------
function ApproveModal({ hero, onCancel, onDone }: { hero: Hero; onCancel: () => void; onDone: (name: string, s: Shadow) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function approve() {
    if (name.trim().length < 2) return setErr("Type your name to sign the approval.");
    setBusy(true);
    const res = await fetch(`/api/leads/${hero.id}/close-won`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: hero.id, signed_by: name.trim(), signed_at: new Date().toISOString(), deal_value: hero.dealValue, currency: hero.currency,
        scope: "shadow_only", allowed_systems: [hero.erp], max_auto_amount: 0, approver_for_stage_b: name.trim(), notes: "",
      }),
    });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr((r.errors ?? ["Approval failed. Run the agent again."]).join(" "));
    onDone(name.trim(), r.shadow);
  }
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="approve-title" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="panel modal">
        <div className="eyebrow">Your approval</div>
        <h2 id="approve-title">Onboard {hero.name}?</h2>
        <p className="muted small">The agent has stopped. It cannot touch this customer&apos;s systems without your signed approval.</p>
        <div className="terms">
          <div>Annual value (proposed)<b>{hero.dealValueLabel}</b></div>
          <div>Access<b>Read-only · {ERP[hero.erp] ?? hero.erp}</b></div>
          <div>Automatic payments<b>{hero.currency === "INR" ? "₹0" : "$0"}, none allowed</b></div>
          <div>Live actions<b>Locked until 95% accuracy on 50+ invoices</b></div>
        </div>
        <label htmlFor="signer">Signed by</label>
        <input id="signer" type="text" autoFocus value={name} placeholder="Your name" onChange={(e) => { setName(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && approve()} />
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn" onClick={onCancel}>Not yet</button>
          <button className="btn gold" disabled={busy} onClick={approve}>{busy ? "Onboarding…" : "Approve & onboard"}</button>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ hero, name, shadow, secs }: { hero: Hero; name: string; shadow: Shadow; secs: number }) {
  const pct = (shadow.accuracyBp / 100).toFixed(2);
  const lines: [string, string, string?][] = [
    [`Approval signed by ${name}`, "Signed"],
    [`Read-only workspace created · ${ERP[hero.erp] ?? hero.erp} connected for reading only`, "Read-only"],
    [`Shadow mode: the agent and their team reviewed the same ${shadow.decided + shadow.reviewed} past invoices`, `${pct}% match`],
    [`${shadow.reviewed} unclear invoices handed to a person`, "Safe"],
    ["Live actions unlock at 95% over 50+ invoices: gate met, still your call", "Your call", "no"],
  ];
  return (
    <div className="onb">
      <div className="eyebrow">Onboarding</div>
      <h1 style={{ margin: "8px 0 18px" }}>{hero.name}</h1>
      <div className="list">
        {lines.map(([t, tag, cls], i) => (
          <div key={t} className="li" style={delay(300 + i * 550)}><div className="who">{t}</div><span className={`tag ${cls ?? ""}`}>{tag}</span></div>
        ))}
      </div>
      <div className="panel done-card in" style={delay(3200)}>
        <div className="eyebrow">Done</div>
        <h2>{hero.name} is live in read-only mode</h2>
        <p className="muted">This run went from first email to an approved customer in {mmss(secs)}. Every number was calculated by code, and the one decision that mattered was yours.</p>
        <div className="row">
          <button className="btn gold" onClick={() => window.location.reload()}>Run it again</button>
          <Link className="btn" href={`/leads/${hero.id}`}>Deal details</Link>
          <Link className="btn" href="/audit">Full audit trail</Link>
        </div>
      </div>
    </div>
  );
}
