# CashFlowPilot — Visitor Experience Redesign

Date: 2026-11-19 · Status: draft, awaiting founder approval · Builds on `2026-11-19-cashflowpilot-design.md`

## Intent
A recruiter or business leader opens the portfolio link and, in about a minute, *watches* the agent find a customer,
prove the savings on that customer's invoices, and stop for the founder's approval. It must feel like a finished,
premium product: one idea per screen, no raw logs, no internal codes.

## Goals / non-goals / anti-goals
- Goals: one clear call to action on landing; an animated run driven by the **real** agent and **real** numbers;
  a before/after ROI reveal that a non-technical leader understands in 5 seconds; the founder approval as the finale.
- Non-goals: new agent logic, new data, login, editing assumptions in the UI.
- Anti-goals: fake/scripted numbers; terminal-style logs; jargon (`PRE_SALE_HOLD`, `UNAUTHORIZED_CHARGE`) on the
  main path; an ROI figure a finance leader would laugh at.

## Approaches
| | Chosen? | Why |
|---|---|---|
| Real agent, paced by the client: each stage calls the API, the animation waits for the result and holds a minimum time | ✅ | Numbers are real; each request stays short (fits Vercel) |
| Pre-recorded animation with fixed numbers | ✗ | Dishonest; breaks if data changes |
| One long server stream (SSE) | ✗ | More moving parts, long requests on serverless |

## Visual direction: B · Midnight & Gold (founder's pick)
Background `#0D1015`, panels `#141920`, hairlines `#222832`, text `#F1EDE4`, muted `#7C8492`, gold `#D4AF6A`
(gradient `#EBCB80 → #B98C35` for the primary button and money). Font: Manrope (Google Fonts). Red only for caught
errors, never decorative. Motion: one pulse on the active step, counters that count up, bars that grow — nothing else.

## Screens
1. **Landing `/`** — wordmark, eyebrow "AUTONOMOUS REVENUE AGENT", headline "The agent that sells by *proving the
   money first.*", one-line lede, one button **Run the agent**, hint "About a minute · simulated companies · nothing
   real is sent". Nothing else above the fold. A quiet footer link "How it's built" (opens a short panel).
2. **Run `/run`** — left: vertical step list in two groups.
   - *Finding the customer*: Research (12 scored) → Outreach (N emails) → Replies (N answered, 1 unsubscribed) →
     Qualified (N said yes to a trial).
   - *The product at work* (follows one hero company, Kaveri Naturals): Sandbox opened → Invoices received (23) →
     Reconciling (rows tick through; caught errors turn red with plain-English labels: "Charged more than the PO",
     "Billed twice", "Wrong GST rate", "Tax doesn't add up", "Charge not on the PO", "Total doesn't add up",
     "Billed for goods not received") → ROI.
   - Right: a live detail panel for the current step (company cards, a quoted reply, the invoice list).
   - Each stage holds ≥ 3 s even if the API is faster; whole run ≈ 60 s. A small "Skip to results" link.
3. **Reveal (same page, final state)** — "What changed for Kaveri Naturals": two bar pairs (hours per batch: manual
   vs agent; overbilling caught: manual vs agent), then three gold figures: protected per month*, hours back per month,
   working capital freed. Footnote: "*Conservative 1% error rate on monthly spend. Every figure computed by code, not
   AI." Primary button **Approve the deal**.
4. **Approval** — a small modal: "The agent has stopped. It cannot onboard Kaveri Naturals without you." One field
   (your name), prefilled read-only summary (deal value, read-only access, ₹0 automatic payments). Approve → animate
   "Onboarding in read-only mode… 57 invoices checked, 100% match with their team" → done card with
   **Run again** and **See the full audit trail**.

## ROI presentation change (code)
Keep "caught in this sample" exactly as computed. Replace the projected-monthly figure: `protectedPerMonth =
monthlyApSpend × 1%` (constant `ASSUMED_ERROR_RATE_BP = 100`, labelled in the UI). Reason: the demo sample is seeded at
~40% bad invoices, so extrapolating its rate overstates savings ~30×.

## What happens to the current pages
`/leads/[id]` and `/audit` stay as the "full audit trail", restyled with the B palette, reachable only from the done
card. The old home page content (log, table, review list, essay) is removed from the main path.

## API additions
`POST /api/run/stage {stage}` advances every lead in the matching state and returns counts + the hero's data for
that stage. Stages: `research | outreach | replies | trial | book`. Approval reuses `close-won`.

## Left to the builder
Exact copy within the above, icon choice, animation easing, mobile layout (steps stack above the detail panel).
