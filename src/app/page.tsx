import Link from "next/link";
import { TopBar } from "./TopBar";
import "./landing.css";

const PREVIEW = [
  { t: "Research", s: "12 companies scored", k: "done" },
  { t: "Outreach", s: "10 emails sent", k: "done" },
  { t: "Replies", s: "8 said yes to a trial", k: "done" },
  { t: "Reconcile invoices", s: "9 problems caught", k: "now" },
  { t: "Your approval", s: "", k: "wait" },
];

export default function Landing() {
  return (
    <div className="landing">
      <TopBar><span>Portfolio project · simulated companies</span><Link href="/readme" className="readme-link">README</Link></TopBar>
      <main className="hero">
        <div>
          <div className="eyebrow">Autonomous revenue agent</div>
          <h1>The agent that sells by <em>proving the money first.</em></h1>
          <p className="lede">
            It finds finance teams, runs a no-risk trial on their own invoices, shows exactly what it recovered — and
            never closes a deal without you.
          </p>
          <div className="choices">
            <Link href="/run" className="choice primary">
              <span className="k">Watch the agent</span>
              <b>The full sales journey →</b>
              <span>Finds companies, pitches, proves savings, waits for your approval. 1 minute, simulated.</span>
            </Link>
            <Link href="/prototype" className="choice">
              <span className="k">Working prototype</span>
              <b>Real invoices, real AI →</b>
              <span>PDF tax invoices and scans read by AI, every number checked by code against POs and receipts.</span>
            </Link>
          </div>
          <div className="proof">
            <div><b>Finds the customer</b>Scores fit, writes the email</div>
            <div><b>Proves the savings</b>On the buyer&apos;s invoices</div>
            <div><b>Waits for your yes</b>Locked until you approve</div>
          </div>
        </div>
        <div className="panel preview" aria-hidden="true">
          <div className="head"><span className="live">Agent running</span><span>Kaveri Naturals</span></div>
          {PREVIEW.map((p, i) => (
            <div key={p.t} className={`pv-step ${p.k}`}>
              <div className="d">{p.k === "done" ? "✓" : i + 1}</div><b>{p.t}</b><span>{p.s}</span>
            </div>
          ))}
          <div className="pv-sum">
            <div><b>₹25.8L</b>overbilling stopped</div>
            <div><b>280 h</b>back per month</div>
            <div><b>0</b>deals closed alone</div>
          </div>
        </div>
      </main>
      <footer className="foot">
        <Link href="/readme" className="readme-card panel">
          <span className="k">README</span>
          <b>What&apos;s real, what&apos;s simulated, and what comes next →</b>
          <span>The demo vs the working prototype, today&apos;s free-tier limits, measured accuracy, and what paid tiers unlock.</span>
        </Link>
      </footer>
    </div>
  );
}
