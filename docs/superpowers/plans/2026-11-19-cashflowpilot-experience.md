# CashFlowPilot Experience Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Replace the console-style UI with landing → animated real agent run → ROI reveal → founder approval (Direction B).
**Architecture:** Server gains `runStage(ws, stage)` (batch-advances leads, returns hero data). One client component
paces the animation against those calls. Old pages stay as the audit trail, restyled.
**Spec:** `docs/superpowers/specs/2026-11-19-cashflowpilot-experience-design.md`

## Global Constraints
- Every number on screen comes from an API response; the client never computes money.
- Palette/typography exactly as spec §Visual direction. No raw state/flag codes on the main path.
- Each stage holds ≥ 3000 ms unless "Skip to results" is pressed.

## Review Focus
1. Visitor presses Run twice / reloads mid-run → run restarts cleanly from a reset workspace (client calls reset first).
2. Expired cookie mid-run → API 401 → page shows "Session expired — start again", not a frozen spinner.
3. Reduced-motion users → no pulsing/counting; final values shown immediately.
4. Narrow phone → steps stack above the detail panel, no horizontal scroll.
5. Approve with an empty name → inline error, no request sent.

### Task 1: ROI honesty + stage API
Files: `src/deterministic/roi.ts`, `src/agents/run.ts`, `src/app/api/run/stage/route.ts`, `src/agents/common.ts`
(fmtShort), tests in `tests/deterministic.test.ts`, `tests/e2e.test.ts`.
- `roi()` returns `protectedPerMonth = monthlyApSpend × ASSUMED_ERROR_RATE_BP(100) / 10000` instead of `projectedMonthlyLeakage`.
- `runStage(ws, "research"|"outreach"|"replies"|"trial"|"book")` → JSON per stage; `HERO = "kaveri"`.
- [ ] Test: ROI fixture `protectedPerMonth === 40_000_000`. Test: running the five stages leaves the hero at
  `PRE_SALE_HOLD` with 23 invoices, 9 flagged; counts match the per-lead journeys.

### Task 2: Shell, landing, palette
Files: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/server.ts` (`pageWs(next)`),
`src/app/api/start/route.ts` (`?next=`).
- [ ] `npm run build` passes; landing shows one button.

### Task 3: Run experience
Files: `src/app/run/page.tsx`, `src/app/run/RunExperience.tsx`, `src/app/run/run.css`, `src/app/api/leads/[id]/close-won/route.ts` (return shadow).
- [ ] Manual: full run in the browser at desktop and 375 px; approval modal validation; 401 path.
