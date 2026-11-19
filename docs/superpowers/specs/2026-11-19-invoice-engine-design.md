# CashFlowPilot — Real Invoice Engine

Date: 2026-11-19 · Status: draft, awaiting founder approval · Project A of two (B = real outreach, later)

## Intent
Make the product part real: the trial runs on actual PDF tax invoices (fictional companies, real structure) and
real ERP-style exports, read the way a production AP tool would — code where code is reliable, AI where layout
understanding is needed, and code checking everything AI returns. A finance leader should recognise the documents
and trust the numbers.

## Goals
1. ~120 realistic **PDF** invoices from 8 fictional suppliers across 4 distinct layouts (3 Indian GST layouts + 1 foreign USD layout); ~10% are **scans**
   (image-only, slightly rotated/noisy).
2. Purchase orders and goods receipts as **ERP-style CSV exports** (Tally/Zoho-like columns), as buyers really hold them.
3. Reading pipeline: text-layer extraction (code) → AI extraction (Claude Haiku 5.5, PDF sent directly) →
   deterministic verification → 3-way match → report.
4. Works with no API key (fallback reader) and never exceeds a hard daily AI budget.
5. Accuracy is *measured*: an eval script reports field-level accuracy of the AI reader against ground truth.

## Non-goals
Real e-invoice signing (IRN/QR from the government portal), ERP connectors, outreach (project B), handwritten invoices.

## Anti-goals
- Any number shown that came from AI without a code check.
- A demo that breaks or looks empty without a key.
- Claiming an accuracy figure we didn't measure.

## Approach (decided)
**A · Real AI with a cap. Default provider: Groq (founder's existing account, free tier)** — text model
`openai/gpt-oss-120b` reads the extracted text layer with a JSON schema; vision model `qwen/qwen3.8-27b` reads scans
(the scan image is pulled out of the PDF by code, since Groq takes images, not PDFs). **Claude Haiku 5.5** is a
one-setting switch (`LLM_PROVIDER=anthropic`) and reads PDFs directly. Both are compared with the eval script.
Fallback when there is no key or the cap is hit: a deterministic **template reader** for the known layouts.
Scans without AI go to human review. AI results are cached by document hash (identical sample PDFs are read once,
shown honestly as a cached AI read). Background leads use the template reader; the hero's trial and shadow mode
use AI.

## Documents (generated, seeded, committed)
- **Suppliers (4 layouts):** a classic bordered table, a modern minimal layout, a dense compact layout, and a
  two-column services layout. Each shows: supplier name/address/**GSTIN**, buyer name/**GSTIN**, place of supply,
  invoice no/date, PO reference, line items (description, HSN/SAC, qty, unit, rate, taxable value), CGST+SGST or
  IGST rows, round-off, grand total, **amount in words**, bank details. Currency shown as "Rs." (standard PDF fonts
  have no ₹ glyph).
- **GSTINs:** valid format and check digit (state code + PAN-shaped + entity + Z + mod-36 checksum).
- **Scans:** rendered to an image, rotated ±1–2°, light noise, wrapped in a PDF (no text layer).
- **Planted defects** (each ≥3×, one per bad invoice): the existing 7 (qty, price, duplicate, GST rate, tax math,
  charge not on PO, total) **plus** invalid supplier GSTIN, wrong tax type for the place of supply (IGST charged
  on an intra-state supply or vice versa), and amount-in-words ≠ total. Answer key built from what was planted.
- **POs / GRNs:** CSV per set with real-looking columns (PO no, date, vendor, item code, qty, rate / GRN no,
  PO no, received qty, date).

## Reading pipeline (per invoice)
1. **Text layer (code):** extract text with a PDF library. Empty ⇒ it's a scan.
2. **AI read:** send the PDF to Haiku 5.5 with a strict schema (header, parties, GSTINs, lines, tax rows, totals,
   amount in words) + confidence. Plain `messages.parse` with structured output; no server-side fallback (not
   available on Haiku 5.5).
3. **Grounding (code, text PDFs):** every number/GSTIN the AI returned must appear in the text layer, else the
   field is rejected ⇒ review. (Catches invented values.)
4. **Verification (code, all PDFs):** GSTIN check digit; place of supply ⇒ correct tax type; qty × rate = line
   value; tax per line; totals incl. round-off; amount-in-words parsed back to a number = total. Scans must pass
   all of these or go to review (no text layer to ground against).
5. **3-way match (code):** existing engine against the CSV POs/GRNs.
6. **Report:** findings, money at risk, before/after — unchanged formulas.

## Two demos side by side (founder decision, 2026-11-19)
The existing 1-minute **simulated demo** (`/run`) stays unchanged. The invoice engine ships as a separate **working
prototype** (`/prototype`) for investors and partners. The landing page offers both, clearly labelled. The shared
reconciliation engine gains the new checks only when an invoice carries the new fields, so the simulated demo's data
and tests are untouched. Prototype data lives in `data/prototype/`; uploads are processed in the request and not stored.

## Product surfaces
- **Run:** the "Invoices received" step shows real PDF thumbnails; during reconciliation one flagged invoice opens
  in an **evidence view** — the PDF on the left, extracted fields on the right, the failing check highlighted.
- **Upload:** in the trial, a visitor can drop their own PDF invoice (≤ 2 MB, ≤ 3 pages, PDF only); same pipeline,
  counted against the cap. No PO/GRN for uploads ⇒ only document checks (GSTIN, tax type, math, words, duplicates).
- **Badges:** each invoice shows how it was read: "Read by AI · verified", "Read by template", "Scan · read by AI ·
  verified", or "Sent to a person".

## Budget & safety
Keys in env: `GROQ_API_KEY` (a separate key for this project), optional `ANTHROPIC_API_KEY` + `LLM_PROVIDER=anthropic`. Existing caps stay (200 real calls/day
global, 30 per lead); add a per-upload limit (5 uploads per visitor per day). Rough cost: ≈ ₹1 per full run.

## Tests (must pass with no key)
1. GSTIN check-digit fixtures; amount-in-words ↔ number round-trip.
2. Template reader recovers every text-PDF field exactly; answer key matched on both sets.
3. Grounding rejects an AI result containing a number absent from the text layer (stubbed model).
4. Scans without AI ⇒ review; with a stubbed AI result that fails verification ⇒ review.
5. Upload: non-PDF, oversize, 4+ pages rejected with clear messages.
6. `npm run eval:ai` (manual, costs money): field-level accuracy of Haiku on all 120 PDFs vs ground truth.

## Left to the builder
Exact visual design of the 4 templates, noise levels for scans, library choices (PDF generation, text extraction,
image rendering) as long as they run on Vercel at request time where needed.
