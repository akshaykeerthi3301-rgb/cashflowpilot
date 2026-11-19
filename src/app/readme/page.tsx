import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "../TopBar";
import "./readme.css";

export const metadata: Metadata = {
  title: "README — CashFlowPilot",
  description: "What CashFlowPilot is today, what is real, what is simulated, what the free tiers limit, and what comes next.",
};

const Yes = () => <span className="yes">Real</span>;
const Sim = () => <span className="sim">Simulated</span>;
const Next = () => <span className="nxt">Not built yet</span>;

export default function Readme() {
  return (
    <div className="readme">
      <TopBar><Link href="/">← Back</Link></TopBar>
      <main className="doc">
        <div className="eyebrow">README</div>
        <h1>What&apos;s real, what&apos;s simulated, and what comes next</h1>
        <p className="lede">
          CashFlowPilot is an AI agent for finance teams: it finds companies that lose money to invoice errors, proves the savings on
          their own invoices, and never acts on money without a person&apos;s approval. Today it exists as two things you can try.
          This page says plainly which parts are real.
        </p>
        <nav className="toc">
          <a href="#offerings">The two offerings</a><a href="#limits">Today&apos;s limits</a><a href="#paid">What paid tiers unlock</a>
          <a href="#how">How it&apos;s built</a><a href="#next">Roadmap</a>
        </nav>

        <section id="offerings">
          <h2>1 · The two offerings</h2>
          <div className="two">
            <div className="panel box">
              <div className="tagline">Demo · simulated</div>
              <h3>Watch the agent: the full sales journey</h3>
              <p>
                A one-minute story of the whole commercial loop: research → outreach → replies → sandbox trial → savings report →
                booked call → <b>your approval</b> → read-only onboarding. It shows <i>how the agent behaves</i>, not live market activity.
              </p>
              <table>
                <tbody>
                  <tr><td>Agent logic, stage rules, approval lock, send limits, audit log</td><td><Yes /></td></tr>
                  <tr><td>Invoice matching and savings maths</td><td><Yes /></td></tr>
                  <tr><td>The 12 companies, their people and their replies</td><td><Sim /></td></tr>
                  <tr><td>Emails (shown on screen, never sent)</td><td><Sim /></td></tr>
                  <tr><td>AI wording (built-in simulator)</td><td><Sim /></td></tr>
                  <tr><td>Calendar booking</td><td><Sim /></td></tr>
                </tbody>
              </table>
              <Link className="btn" href="/run">Watch the demo →</Link>
            </div>
            <div className="panel box gold">
              <div className="tagline">Working prototype</div>
              <h3>Real invoices, real AI: the invoice engine</h3>
              <p>
                The product itself, working on real-format documents: 64 PDF tax invoices from 8 suppliers in 4 layouts (7 are
                photocopied scans), plus purchase-order and goods-receipt exports. AI reads; code checks every number.
              </p>
              <table>
                <tbody>
                  <tr><td>PDF reading by AI (Groq), scans included</td><td><Yes /></td></tr>
                  <tr><td>10 checks: GST number, tax type vs state, GST rate, line maths, totals, round-off, amount in words, duplicates, PO price, goods received</td><td><Yes /></td></tr>
                  <tr><td>Matching every line to its purchase order and goods receipt</td><td><Yes /></td></tr>
                  <tr><td>Upload your own PDF invoices</td><td><Yes /></td></tr>
                  <tr><td>The companies on the invoices</td><td><Sim /></td></tr>
                </tbody>
              </table>
              <div className="measured">
                <div><b>99.7%</b>of 693 fields read correctly</div>
                <div><b>98.4%</b>of final verdicts right</div>
                <div><b>61</b>automated tests pass</div>
              </div>
              <p className="small muted">Measured on all 64 sample PDFs with Groq on 19 Nov 2026 (<code>npm run eval:ai</code>). The one wrong verdict was on a scan, which the product already marks for a person to confirm.</p>
              <Link className="btn gold" href="/prototype">Open the prototype →</Link>
            </div>
          </div>
        </section>

        <section id="limits">
          <h2>2 · Today&apos;s limits (we run on free tiers)</h2>
          <p>The code works. What holds it back today is the free plans it runs on, and a few deliberate scope limits.</p>
          <table className="wide">
            <thead><tr><th>Limit</th><th>What you&apos;ll notice</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>AI rate limit</td><td>Sample batches show AI reads <b>recorded from a real Groq run</b> (marked &quot;cached&quot;). Uploads are read live; if Groq is busy, a known layout is read by code and a scan goes to a person, and the screen says so.</td><td>Groq&apos;s free plan allows 8,000 tokens per minute per model (≈3 invoices a minute) and 1,000 requests a day, shared with another project.</td></tr>
              <tr><td>Open AI models</td><td>Scans are read less reliably than clean PDFs, so problems found on a scan are marked &quot;confirm&quot;.</td><td>The free tier runs open models (gpt-oss-120b for text, a Qwen vision model for scans).</td></tr>
              <tr><td>Uploads</td><td>Up to 5 PDFs, 2 MB and 3 pages each. Only document checks run (no purchase orders to match). Files are not stored.</td><td>Abuse and cost protection on a public demo.</td></tr>
              <tr><td>Coverage</td><td>Indian GST and US invoices. The GST-rate table covers the sample products&apos; HSN codes, not the full schedule.</td><td>Prototype scope.</td></tr>
              <tr><td>Hosting</td><td>The first visit after a quiet period can be a few seconds slower.</td><td>Free hosting and database tiers pause when idle.</td></tr>
              <tr><td>No login</td><td>In the demo, whoever clicks &quot;Approve&quot; plays the founder.</td><td>Public demo. The approval rule itself is enforced on the server.</td></tr>
              <tr><td>No live connections</td><td>Nothing connects to a real ERP, bank, inbox or calendar.</td><td>By design, until those integrations are built (see below).</td></tr>
            </tbody>
          </table>
        </section>

        <section id="paid">
          <h2>3 · What paid tiers unlock</h2>
          <p>Two kinds: things the code already supports (a settings change), and things that need building <i>and</i> a paid account.</p>
          <table className="wide">
            <thead><tr><th>Capability</th><th>Status</th><th>What it takes</th></tr></thead>
            <tbody>
              <tr><td>Live AI reading of whole batches in seconds</td><td><span className="yes">Ready: a setting</span></td><td>A paid Groq plan, or Claude (Haiku 5.5 is roughly ₹1 per demo run). Switching is one environment variable; the accuracy test compares models.</td></tr>
              <tr><td>Dedicated AI capacity for this product</td><td><span className="yes">Ready: a setting</span></td><td>Its own AI account and key, so demo traffic never competes with other projects.</td></tr>
              <tr><td>Always-on hosting, bigger database</td><td><span className="yes">Ready: a setting</span></td><td>Paid Vercel and Neon plans. No code change.</td></tr>
              <tr><td>Researching real companies and finance contacts</td><td><Next /></td><td>A company/contact data provider (paid), plus a legal review of outreach rules (India&apos;s data-protection law; anti-spam rules for the US/EU).</td></tr>
              <tr><td>Sending and reading real email</td><td><Next /></td><td>A sending domain on Google Workspace or an email service, domain warm-up, an inbox connection, and a founder approval queue before every send.</td></tr>
              <tr><td>Booking real calls</td><td><Next /></td><td>Google Calendar or Cal.com integration.</td></tr>
              <tr><td>Reading a customer&apos;s accounts</td><td><Next /></td><td>Read-only connectors for Tally, Zoho Books or QuickBooks, starting with whichever the first customers use.</td></tr>
            </tbody>
          </table>
        </section>

        <section id="how">
          <h2>4 · How it&apos;s built</h2>
          <div className="three">
            <div className="panel box"><h3>Code decides</h3><p>Every rupee: invoice ↔ purchase order ↔ goods receipt matching, GST to the paisa, totals, ROI, lead scores, send limits and every stage change. No AI produces a number you see.</p></div>
            <div className="panel box"><h3>AI reads and writes</h3><p>Reads invoices and company news, drafts emails, answers only from approved documents. Every value it returns must appear on the page, then passes the code checks. Unsure ⇒ a person.</p></div>
            <div className="panel box"><h3>People approve</h3><p>The agent stops at the deal. Only the founder can release it, and a new customer starts read-only until accuracy is proven: 95% or better over 50+ invoices.</p></div>
          </div>
        </section>

        <section id="next">
          <h2>5 · Roadmap: from prototype to product</h2>
          <ol className="road">
            <li><b>Dedicated, paid AI tier</b>: live batch reading for every visitor and customer.</li>
            <li><b>Real outreach</b>: company research, published business emails, sends from our domain only after founder approval, AI-sorted replies.</li>
            <li><b>Accuracy on real documents</b>: 50–100 real, anonymised invoices from pilot customers, with the accuracy test run on them.</li>
            <li><b>Read-only accounting connectors</b>: Tally / Zoho Books / QuickBooks, starting in read-only shadow mode.</li>
            <li><b>Accounts and security</b>: founder login, separate customer workspaces, data-retention policy.</li>
          </ol>
          <div className="row" style={{ marginTop: 24 }}>
            <Link className="btn gold" href="/prototype">Try the working prototype →</Link>
            <Link className="btn" href="/run">Watch the sales demo</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
