# Invoice Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** The trial and shadow mode read real PDF invoices + ERP CSV exports instead of JSON.
**Spec:** `docs/superpowers/specs/2026-11-19-invoice-engine-design.md`

## Global Constraints
- The reading pipeline never reads ground-truth JSON; only PDF bytes + CSV exports. Truth is used only by tests/eval.
- Money in integer paise/cents. Every AI-returned number is grounded (text PDFs) and verified (all PDFs) by code.
- Works with zero env vars (template reader; scans → review). Real AI calls cached by document hash and capped.

## Review Focus
1. Uploaded PDF with no text layer and no embedded JPEG → "needs a person", not a crash.
2. Corrupt / password-protected / non-PDF upload → clear 400.
3. Groq 429 rate limit → retried with backoff, then template fallback; demo continues.
4. AI returns a plausible number not printed on the page → rejected by grounding.
5. Round-off of ±₹0.50 on the grand total is not flagged as TOTAL_MISMATCH.

### Task 1: Indian document utilities — `src/deterministic/gst.ts`
`gstinCheckChar(first14)`, `isValidGstin(s)`, `amountInWords(minor, currency)`, `wordsToMinor(s)`, `parseAmount(s)`.
- [ ] Tests: known-valid GSTIN `27AAPFU0939F1ZV`; words round-trip for 0.50, 1,00,000.00, 12,34,567.89; USD words.

### Task 2: Generator — `scripts/generate-sample-data.ts`
Outputs `data/erp/{vendors,trial-pos,trial-grns,shadow-pos,shadow-grns}.csv`, `data/pdfs/{trial,shadow}/<id>.pdf`,
`data/truth.json` (truth invoices + answer key + smudged/scan ids). 4 layouts, ~10% scans (JPEG via @napi-rs/canvas),
3 new defects. Round-off to the rupee.
- [ ] `npm run gen:data` prints counts; every defect type ≥ 3 per set.

### Task 3: PDF reading — `src/documents/{pdf,template,read}.ts`
`pdfLines(bytes)`, `scanImage(bytes)`, `readByTemplate(lines)`, `readInvoice(bytes, opts)` →
`{ invoice | null, readBy, checks, reason? }`; AI path in `src/providers/llm.ts` (`groq` | `anthropic`) + `doc_cache` table.
- [ ] Tests: template reader recovers every text PDF exactly vs truth; scans → review without AI; grounding rejects a
  stubbed AI number absent from the page; stubbed Groq vision result that fails verification → review.

### Task 4: Engine — `src/deterministic/reconcile.ts`
Declared tax type, round-off, new flags `INVALID_GSTIN`, `WRONG_TAX_TYPE`, `WORDS_MISMATCH`; POs/GRNs from CSV.
- [ ] Test: both sets read from PDFs (no key) match the answer key on every non-review invoice.

### Task 5: Prototype page + landing choice (Blueprint Delta: simulated `/run` untouched)
`/prototype`: sample batch or upload → live per-document reading → reconciliation + evidence view + report; `/api/docs/[set]/[id]` serves PDFs; PDF upload; evidence view in the run.
- [ ] Build passes; browser run shows read-by badges and the evidence view; upload works.

### Task 6: `scripts/eval-ai.ts`, README, final checks.
