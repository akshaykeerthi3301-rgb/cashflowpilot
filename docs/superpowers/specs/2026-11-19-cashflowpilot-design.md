# CashFlowPilot — Design

Date: 2026-11-19 · Status: draft, awaiting founder approval

## 1. Intent

A **portfolio project**: a public, $0-to-run demo of an autonomous go-to-market-to-production agent for an
invoice-to-cash reconciliation product. Visitors to the founder's portfolio open one link and watch
(or drive) the agent through the whole commercial lifecycle against **fictional** companies:

find & score → pitch by email → sandbox trial on ~60 sample invoices → pre-call brief + booked call →
hard lock → visitor (playing founder) marks `CLOSED_WON` + signs a Release Directive → tenant provisioned in
read-only Shadow Mode → accuracy scorecard → (gated) assisted live mode.

**Why:** prove rigorous agent design to reviewers/interviewers — code does all money math and enforces every
gate; AI is bounded, schema-checked and budget-capped. **Secondary why:** every simulated part sits behind a
seam so it can be swapped for a real provider later (path to a real business, §11).

## 2. Goals

1. One lead runs end to end in under ~2 minutes of clicks; a "Run full demo" button auto-advances it.
2. All arithmetic (invoice/PO/GRN totals, GST, ROI, lead score, shadow accuracy) in pure TypeScript, tested
   against a fixed answer key.
3. Provisioning is **provably impossible** before `CLOSED_WON` + valid Release Directive — enforced server-side
   and covered by tests.
4. $0 to host and run; works fully with **no AI key**.
5. Each visitor gets an isolated workspace that can be reset; visitors never see each other's data.

## 3. Non-goals (v1)

Real emails, real companies or people, real ERP/bank/payment connections, user login/teams, OCR of scanned
image invoices (v1 reads CSV/JSON plus plain-text invoices), mobile app, multi-language UI.

## 4. Anti-goals (failure even if it "works")

- The agent sets `CLOSED_WON` itself, or any path skips the lock.
- An LLM produces a number that is shown as a financial result.
- The public demo can email a real address or let a visitor run up an AI bill.
- The demo breaks or looks empty when no AI key is configured.
- Real people's names/emails appear anywhere.

## 5. Constraints

- Hosting: Vercel Hobby (free, serverless — no persistent filesystem, short request lifetimes ⇒ every agent
  step is a short request; long runs are a chain of steps, never one long call).
- Database: Neon free Postgres in production; **PGlite** (Postgres compiled to run in-process, no install)
  for local dev and tests — same SQL in both, chosen by whether `DATABASE_URL` is set.
- No secrets in code; all keys via environment variables; `.env.example` documents them.
- Fictional data only (`.example` email domains, invented company names).

## 6. Approaches considered

| | A. One Next.js app on Vercel + Neon | B. Python API on Render + UI on Vercel | C. Browser-only |
|---|---|---|---|
| Cost | $0 | $0 | $0 |
| First-visit speed | fast | ~50 s cold start on free tier | fastest |
| Deploys | 1 | 2 | 1 |
| Lock enforced server-side | yes | yes | **no** (visitor can bypass) |

**Chosen: A** (Claude's call; founder handed over the how). B loses portfolio visitors on cold start;
C turns the hard lock — the centrepiece — into decoration.

## 7. Decisions

### 7.1 Stack (Claude's call)
Next.js (App Router) + TypeScript, Zod for schemas, raw SQL via `@neondatabase/serverless` / PGlite behind one
tiny `db.query()` helper, Vitest for tests. No ORM, no UI kit beyond plain CSS (Tailwind acceptable if it
speeds layout). Money stored and computed as **integer minor units** (paise/cents) — never floats.

### 7.2 Repository layout (spec mapped onto Next.js)
```
src/state_machine/   states, transition table, guards, CLOSED_WON + Release Directive gate
src/deterministic/   reconcile (3-way match), gst, roi, lead_score, limits (caps/budgets/backoff),
                     audit, shadow_scorecard
src/agents/          researcher, outreach_sandbox, trial_pitcher, deal_prep_booker, provisioner_shadow
src/providers/       llm (mock + real), mailer (outbox), calendar (slots + .ics), leads (seed data)
src/schemas/         Zod models for every stage hand-off + ReleaseDirective
src/app/             pages + API routes (the spec's `api_or_ui/`; Next.js requires `app/`)
data/                fictional companies, buyer personas, generated invoices/POs/GRNs + answer key
scripts/             generate-sample-data.ts (fixed random seed ⇒ identical data every run)
tests/               unit + integration + end-to-end flow
```

### 7.3 State machine
States: `DISCOVERED → OUTREACH_ACTIVE → SANDBOX_TRIAL → CALL_BOOKED → PRE_SALE_HOLD → PROVISIONING →
STAGE_A_SHADOW_MODE → STAGE_B_PRODUCTION_ACTIVE`, plus terminal `OPTED_OUT` and `CLOSED_LOST`
(reachable from any pre-sale state).

- One `transition(lead, to, actor, payload)` function is the **only** writer of `lead.state`. It checks the
  allowed-transitions table, runs the guard, writes state + audit row in one DB transaction.
- `actor` is `agent` or `founder`. Guards:
  - `CALL_BOOKED → PRE_SALE_HOLD`: automatic when call booked and brief exists.
  - `PRE_SALE_HOLD → PROVISIONING`: **actor must be `founder`**, deal flag `CLOSED_WON`, and a ReleaseDirective
    that passes schema validation and is linked to this lead. Agent calls are rejected with an audit entry.
  - `STAGE_A → STAGE_B`: founder actor **and** shadow accuracy ≥ 95% over ≥ 50 invoices (thresholds in one
    constants file).
- Every rejected transition is logged, not silently ignored.

### 7.4 Release Directive (schema)
`lead_id, signed_by (name), signed_at, deal_value (minor units + currency), scope: "shadow_only",
allowed_systems: string[] (from a fixed list), max_auto_amount (minor units; 0 in Stage A),
approver_for_stage_b, notes`. Missing/invalid field ⇒ rejected.

### 7.5 Deterministic engines
- **Reconciliation (3-way match):** invoice vs PO vs GRN (goods receipt note) per line. Flags: quantity
  mismatch, unit-price mismatch, duplicate invoice number (same supplier), GST rate wrong for HSN class, tax
  arithmetic error, surcharge/line not on PO, total mismatch. Tolerances in constants (e.g. price ±0.5%).
  GST: intra-state CGST+SGST, inter-state IGST, by supplier/buyer state codes.
- **ROI:** hours saved = invoices × manual minutes per invoice (editable assumption, default 12) ÷ 60;
  cash leakage caught = Σ overbilled amounts + duplicates; working capital freed = DSO (days sales
  outstanding) reduction days × annual revenue ÷ 365. Every assumption shown next to the number.
- **Lead score (0–100):** weighted fit (industry, size band, region, ERP used) + signals (finance hiring,
  funding, growth) + persona match. Weights in one table; score breakdown shown.
- **Limits / circuit breakers:** daily send cap per workspace (20); opt-out check before every send;
  per-trial AI budget (30 calls); 3 retries with exponential backoff on provider calls; confidence < 0.7 or
  missing required field ⇒ item goes to a "Needs human review" queue, stage halts for that lead.
- **Audit log:** append-only table; every transition, send, AI call (with token count), and rejection.
- **Shadow scorecard:** agent's match decisions on a held-out batch compared to the answer key ⇒ accuracy,
  precision, recall per flag type.

### 7.6 AI layer
- Uses: extract growth/hiring signals from fictional company blurbs, draft outreach, answer trial questions
  from an approved FAQ, draft dispute emails, summarise trial into the Pre-Call Brief.
- Every AI output is parsed by a Zod schema with `confidence` and `source_refs`; failure ⇒ human review.
- **Mock provider is the default**: deterministic templated outputs, so the demo is complete with no key.
- Optional real provider (Claude by default; any OpenAI-compatible free tier also pluggable) enabled by env
  key, behind a **global daily cap** (e.g. 200 calls/day across all visitors) — exceeding it falls back to mock.

### 7.7 Simulated world
- ~12 fictional companies across B2B SaaS, D2C/retail, logistics, manufacturing; India (GST) and global.
  Each has a finance contact and a **buyer persona** with deterministic behaviour: *eager*, *skeptical then
  convinced by trial numbers*, *no reply*, *opts out*. Persona replies are rule-triggered by agent actions
  (with optional AI wording on top).
- Emails go to an **outbox** table rendered in the UI as a mail thread; nothing is sent.
- Buying intent score computed in code from trial events (files uploaded, sessions, questions, ROI viewed);
  above threshold ⇒ deal prep runs.
- Booking: agent proposes slots from a fictional founder calendar; result also downloadable as a real
  `.ics` invite file.
- **Sample data:** generator makes two sets, each ~60 invoices + matching POs + GRNs across ~8 fictional
  suppliers, INR and USD, ~60% clean and ~40% with planted defects (each defect type ≥ 3 times), plus
  `answer_key.json`: a **trial pool** (each prospect gets its own deterministic slice of ~25, so findings
  differ per buyer) and a **held-out shadow batch** of 60 (so the ≥ 50-invoice Stage B gate is meaningful).
  ~10 invoices per set are messy plain text that needs AI extraction — the realistic place for low
  confidence and human-review routing, so shadow accuracy is not a trivial 100%. Visitors may also upload
  their own CSV in the documented format. (Claude's call: generated, not downloaded — real online
  invoices carry real companies' data.)

### 7.8 Visitor workspaces
Cookie holds a random workspace id; every table row carries `workspace_id`; a new workspace is seeded from
`data/`. "Reset demo" wipes the visitor's rows. Workspaces older than 24 h are purged when a new one is
created (no scheduled job needed). Basic rate limit per workspace on API routes.

### 7.9 Screens
1. **Leads** — table with score + state badge; "Run full demo" button. Auto-run **stops at
   `PRE_SALE_HOLD`** and hands the visitor the founder role — that pause is the demo's key moment.
2. **Lead detail** — timeline (audit), outbox thread, score breakdown.
3. **Sandbox trial** — invoice table with flags, ROI panel, trial Q&A box.
4. **Pre-Call Brief** — one page, printable.
5. **Deal room** — the lock, `CLOSED_WON` button, Release Directive form; shows rejection if agent tried.
6. **Shadow mode** — accuracy scorecard, Stage B gate status.
7. **Audit log** — filterable.
Plus a short "How it works" panel naming which parts are code vs AI (aimed at portfolio reviewers).

## 8. Acceptance criteria (tests must prove)

1. Reconciliation finds every planted defect in the answer key and flags no clean invoice (100% on seed data).
2. GST and ROI functions match hand-computed fixtures to the paisa/cent.
3. Agent-initiated `PRE_SALE_HOLD → PROVISIONING` is rejected; founder without directive is rejected;
   founder + valid directive succeeds. Every illegal jump in the transition table is rejected.
4. 21st send in a day is blocked; send to opted-out contact is blocked; 31st AI call in a trial falls back.
5. Low-confidence AI output routes to review instead of advancing.
6. End-to-end: seeded lead goes `DISCOVERED → STAGE_A_SHADOW_MODE` with mock AI and no network.
7. Two workspaces never see each other's rows.
8. `npm run build` passes; app runs locally with zero env vars.

## 9. Delivery order

1. Schemas + state machine + deterministic engines + tests.
2. Sample-data generator + answer key.
3. Five agents + providers (mock first).
4. Pages + API routes.
5. End-to-end test, deploy notes for Vercel + Neon.

## 10. Left to the builder

Visual design and copy, exact persona scripts, company names, number of companies (10–15), exact
tolerance values within the stated ranges, Tailwind or plain CSS.

## 11. Path to a real business (not built in v1)

| Simulated now | Real swap later |
|---|---|
| Seeded fictional companies | Paid company/contact data provider |
| Outbox table | Email provider on a separate sending domain + unsubscribe link |
| Fake founder calendar | Google Calendar / Cal.com API |
| Mock AI | Claude API with per-tenant budgets |
| Sample invoices | Customer ERP (Tally, Zoho Books, QuickBooks) read-only connectors |
| Stage B drafts only | Bank/payment connectors behind approval thresholds |
