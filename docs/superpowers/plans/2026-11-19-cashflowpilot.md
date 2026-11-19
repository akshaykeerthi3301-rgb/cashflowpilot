# CashFlowPilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, public Next.js demo where an agent takes fictional companies from discovery to shadow-mode
provisioning, with all money math and gates in deterministic code.

**Architecture:** One Next.js App Router app. Pure TS engines (`src/deterministic`, `src/state_machine`) have no
I/O and are unit-tested. Agents (`src/agents`) do one short step per call, read/write Postgres through one
`query()` helper, and call AI only through `src/providers/llm.ts` (mock by default). UI is server components +
small client buttons hitting POST route handlers.

**Tech Stack:** Next.js + React + TypeScript, Zod, PGlite (local/tests), `@neondatabase/serverless` (prod),
Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-19-cashflowpilot-design.md`

## Global Constraints

- Money = integer minor units (paise/cents). No floats in money paths.
- Only `transition()` writes `leads.state`; every transition and rejection writes an audit row.
- `PRE_SALE_HOLD → PROVISIONING` needs actor `founder` + `deal_status='CLOSED_WON'` + valid ReleaseDirective.
- `STAGE_A → STAGE_B` needs actor `founder` + shadow decided ≥ 50 + accuracy ≥ 9500 bp.
- Caps: 20 sends/workspace/day; 30 AI calls/lead; 200 real AI calls/day global; 3 retries w/ backoff;
  AI confidence < 0.7 ⇒ review queue. Outreach threshold score ≥ 60; deal-prep threshold intent ≥ 70.
- Runs with zero env vars. Fictional data only (`*.example` emails).
- Every row carries `workspace_id`; all queries filter by it.

## Review Focus

1. Visitor with stale/forged `ws` cookie ⇒ gets a fresh workspace, never another's data (e2e test: unknown ws).
2. Double-click "advance" ⇒ transition uses `WHERE state = $from`, second call is a no-op, not a double send (e2e test).
3. Directive with `lead_id` of another lead ⇒ rejected (state machine test).
4. Uploaded CSV with bad rows ⇒ 400 with row numbers, nothing stored (parse test in Task 6).
5. Real AI returns non-JSON ⇒ treated as low confidence / falls back, never crashes the step (llm test).

---

### Task 1: Project setup + DB helper

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`,
`.gitignore`, `src/db.ts`, `src/db/schema.sql`. Test: `tests/db.test.ts`.

**Interfaces — Produces:** `query<T>(sql: string, params?: unknown[]): Promise<T[]>`;
`resetDbForTests(): Promise<void>`. PGlite in-memory under Vitest, PGlite on `./.pglite` in dev, Neon when
`DATABASE_URL` set. Schema applied once per process.

Tables: `workspaces(id, created_at)`, `leads(workspace_id,id,company_id,name,industry,region,persona,
contact_name,contact_role,contact_email,state,score,score_breakdown jsonb,intent int,trial jsonb,brief jsonb,
call_at,deal_status,shadow jsonb, pk(workspace_id,id))`, `outbox(id serial, workspace_id, lead_id, direction,
subject, body, created_at)`, `audit(id serial, workspace_id, lead_id, actor, action, detail jsonb, created_at)`,
`review_queue(id serial, workspace_id, lead_id, reason, payload jsonb, created_at)`,
`directives(workspace_id, lead_id, data jsonb, pk)`, `opt_outs(workspace_id, email, pk)`,
`usage(scope, day, key, count, pk(scope,day,key))`.

- [ ] Test: `query('select 1 as x')` returns `[{x:1}]`. Run `npx vitest run tests/db.test.ts` → PASS.

### Task 2: Schemas + state machine

**Files:** `src/schemas/index.ts`, `src/state_machine/index.ts`. Test: `tests/state_machine.test.ts`.

**Produces:** `State` union (8 + `OPTED_OUT`, `CLOSED_LOST`); `Actor = 'agent'|'founder'`;
`ReleaseDirectiveSchema` (spec §7.4); `checkTransition(lead: LeadGateView, to: State, actor: Actor, directive?:
unknown): {ok:true}|{ok:false; reason:string}` (pure); `transition(ws, leadId, to, actor, detail?) =>
Promise<{ok:boolean; reason?:string}>` (atomic `UPDATE … WHERE state=$from` + audit insert in one CTE).

- [ ] Tests: every pair not in the table rejected; agent → PROVISIONING rejected; founder w/o CLOSED_WON
  rejected; founder + CLOSED_WON + directive for another lead rejected; founder + valid directive ok;
  STAGE_B rejected at 9499 bp or 49 decided, ok at 9500 bp/50.

### Task 3: Deterministic engines

**Files:** `src/deterministic/{money,gst,reconcile,roi,lead_score,intent,limits,shadow}.ts`.
Tests: `tests/deterministic.test.ts`.

**Produces:**
- `roundDiv(n,d)`; `lineTax(base, rate, intra): {cgst,sgst,igst}`; `EXPECTED_GST: Record<hsn, rate>`.
- `reconcile(batch: Invoice[], pos: PO[], grns: GRN[]): Finding[]` — `Finding = {invoiceId, flags: Flag[],
  expectedTotal, overbilled}`; `Flag` = `QTY_MISMATCH|PRICE_MISMATCH|DUPLICATE_INVOICE|GST_RATE_WRONG|
  TAX_MATH_ERROR|UNAUTHORIZED_CHARGE|TOTAL_MISMATCH`. Price tolerance 50 bp.
- `roi(input) => {hoursSavedPerMonth10 (tenths), leakageBp, projectedMonthlyLeakage, workingCapitalFreed,
  assumptions}`.
- `scoreLead(company, signals) => {score, breakdown}` (weights spec §7.5; signals < 0.7 ignored).
- `intentScore(events: string[]) => number`.
- `withBackoff(fn, {retries:3, baseMs, sleep})`; `bumpUsage(scope, key, limit) => Promise<boolean>`.
- `scorecard(findings, answerKey, reviewedIds) => {decided, correct, accuracyBp, reviewed, perFlag}`.
- [ ] Tests: GST intra/inter fixtures to the paisa; ROI fixture; score fixture; backoff retries 3 then throws.

### Task 4: Sample data + answer key

**Files:** `data/companies.json` (12), `data/faq.json`, `scripts/generate-sample-data.ts` →
`data/invoices.json` `{trial:{invoices,pos,grns}, shadow:{…}, answerKey:{[invoiceId]: Flag[]}}`.
Seeded PRNG (mulberry32, seed 42). One planted defect per bad invoice, each type ≥ 3 per set; duplicates
share supplier with their original; ~10 per set have only `raw` text, 3 of those deliberately smudged.

- [ ] Test (`tests/reconcile.test.ts`): reconcile(trial) and reconcile(shadow) flags equal answer key for
  every structured invoice; text invoices via mock extractor equal answer key or go to review.

### Task 5: Providers

**Files:** `src/providers/{llm,calendar,world}.ts`. Test: `tests/llm.test.ts`.

**Produces:** `llm.extractSignals`, `llm.draftOutreach`, `llm.answerQuestion`, `llm.extractInvoice`,
`llm.writeBrief` — each `Promise<{data, source:'mock'|'model', confidence}>`; real path (Anthropic Messages via
fetch, `ANTHROPIC_API_KEY`, `LLM_MODEL`) only when key set and caps allow, Zod-validated, invalid ⇒
confidence 0. `calendar.nextSlot(taken: string[]) => string`; `calendar.ics(lead) => string`.
`world.buyerReply(persona, step)`, `world.trialActivity(persona)` (deterministic personas).

- [ ] Tests: mock answers FAQ; invalid model JSON ⇒ confidence 0 (fetch stubbed).

### Task 6: Agents + orchestration

**Files:** `src/agents/{researcher,outreach_sandbox,trial_pitcher,deal_prep_booker,provisioner_shadow,
advance}.ts`, `src/workspace.ts`. Test: `tests/e2e.test.ts`.

**Produces:** `research(ws)`, `advance(ws, leadId) => {did:string}` (one step by state),
`askTrialQuestion(ws, leadId, q)`, `founderCloseWon(ws, leadId, directive)`, `agentTryProvision(ws, leadId)`,
`promoteStageB(ws, leadId)`, `createWorkspace()`, `ensureWorkspace(id?)`, `resetWorkspace(ws)`,
`parseInvoiceCsv(text) => {ok, rows}|{ok:false, errors:{row,msg}[]}`.

- [ ] Tests: eager lead reaches `PRE_SALE_HOLD` via `advance` loop; agent provision rejected + audited;
  founder close-won ⇒ `STAGE_A_SHADOW_MODE` with scorecard; 21st send blocked; opted-out never emailed;
  31st AI call per lead falls back; workspace isolation; double advance no double send.

### Task 7: UI + API

**Files:** `src/app/{layout.tsx,globals.css,page.tsx}`, `src/app/leads/[id]/page.tsx`,
`src/app/leads/[id]/brief/page.tsx`, `src/app/audit/page.tsx`, `src/app/actions.tsx` (client buttons),
`src/app/api/**/route.ts` (start, research, reset, advance, ask, close-won, agent-provision, promote, ics,
upload).

- [ ] `npm run build` passes; manual run in browser: full demo → lock → close-won → shadow scorecard.
