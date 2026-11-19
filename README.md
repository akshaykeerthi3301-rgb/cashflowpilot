# CashFlowPilot

A portfolio demo of an autonomous go-to-market agent for an invoice-to-cash reconciliation product. It researches
fictional companies, pitches them, runs a zero-risk sandbox trial on sample invoices, writes a pre-call brief, books
the call — then **locks** until the founder marks the deal `CLOSED_WON` and signs a Release Directive. The customer
then starts in read-only Shadow Mode.

**Rule of the codebase:** code does every calculation and enforces every gate; AI only reads messy text and writes
words, behind schemas, confidence thresholds and budgets. All companies, people and invoices are fictional.

## Two demos

| Page | What it is |
|---|---|
| `/run` — **simulated demo** | The whole sales journey in one minute: research, outreach, replies, trial, ROI, founder approval. Fictional data. |
| `/prototype` — **working prototype** | The invoice engine on real documents: 64 PDF tax invoices (4 layouts, 7 photocopied scans) + purchase-order and goods-receipt exports. AI reads, code checks every number. Visitors can upload their own PDFs. |

How the prototype reads an invoice: code pulls the PDF's text layer → AI (Groq by default) copies the values exactly as
printed → code confirms every value is on the page → code converts and checks GSTIN, tax type, line maths, totals,
round-off and amount in words → 3-way match against PO and goods receipt. Scans have no text layer: the image is sent to
a vision model, and anything that doesn't add up goes to a person. Without a key, known layouts are read by code.

```bash
npm run gen:prototype   # regenerate the prototype PDFs + ERP exports (fixed seed)
npm run eval:ai         # measure AI reading accuracy vs ground truth (needs GROQ_API_KEY in .env.local)
```

## Run it locally (no accounts, no keys)

```bash
npm install
npm run dev        # http://localhost:3000 → "Run the agent" (about a minute)
npm test           # 59 tests: money math, answer key, lock, circuit breakers, end-to-end
npm run gen:data   # regenerate the 120 sample invoices (fixed seed, same output every time)
```

Local data lives in `./.pglite` (an in-process Postgres). Delete it to start clean.

## Deploy free on Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. In Vercel → Storage, add a **Neon** Postgres database (free plan). It sets `DATABASE_URL` for you.
3. Deploy. Tables are created automatically on first request.
4. Optional: set `GROQ_API_KEY` (a separate key for this project) to turn on AI reading. Capped at 300 model calls/day
   across all visitors; identical documents are read once (cached); past the cap it falls back to code.

## Where things live

| Folder | What it does |
|---|---|
| `src/state_machine/` | States, allowed transitions, guards, the pre-sale lock. `transition()` is the only writer of a lead's stage. |
| `src/deterministic/` | 3-way match + GST, ROI, lead/intent scoring, send caps & AI budgets & retries, shadow scorecard, CSV parsing. |
| `src/agents/` | `researcher`, `outreach_sandbox`, `trial_pitcher`, `deal_prep_booker`, `provisioner_shadow`, plus `advance` (one step per request). |
| `src/providers/` | `llm` (the only AI entry point), `calendar` (.ics), `world` (simulated buyers). |
| `src/schemas/` | Zod contracts for every hand-off, including the Release Directive. |
| `src/app/` | Pages and API routes (the spec's `api_or_ui`). |
| `data/` | Fictional companies, approved FAQ, generated invoices/POs/GRNs + answer key. |
| `docs/superpowers/` | Design spec and implementation plan. |

## What is simulated (and what would replace it)

| Simulated | Real version |
|---|---|
| 12 fictional companies | Company/contact data provider |
| On-screen outbox | Email provider on a separate sending domain |
| Scripted buyer replies | Real inboxes |
| Fake founder calendar | Google Calendar / Cal.com |
| AI simulator | Claude API (already wired; set the key) |
| Sample invoices | Read-only ERP connectors (Tally, Zoho Books, QuickBooks…) |
| Founder = whoever clicks | Real login for the founder routes |
