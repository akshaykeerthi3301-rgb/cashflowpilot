import { describe, expect, test } from "vitest";
import { checkTransition, TRANSITIONS, type LeadGateView } from "@/state_machine";
import { STATES, type State } from "@/schemas";

const lead = (over: Partial<LeadGateView> = {}): LeadGateView => ({
  id: "L1",
  state: "PRE_SALE_HOLD",
  score: 80,
  intent: 80,
  brief: { ok: 1 },
  call_at: "2026-11-20T10:00",
  deal_status: "CLOSED_WON",
  shadow: null,
  ...over,
});
const directive = (over: Record<string, unknown> = {}) => ({
  lead_id: "L1",
  signed_by: "Demo Founder",
  signed_at: "2026-11-19",
  deal_value: 1200000,
  currency: "INR",
  scope: "shadow_only",
  allowed_systems: ["tally"],
  max_auto_amount: 0,
  approver_for_stage_b: "Demo Founder",
  ...over,
});

describe("transition table", () => {
  test("every jump not in the table is rejected", () => {
    for (const from of STATES)
      for (const to of STATES) {
        if (TRANSITIONS[from].includes(to)) continue;
        const v = checkTransition(lead({ state: from }), to, "founder", directive());
        expect(v.ok, `${from}->${to}`).toBe(false);
      }
  });
  test("cannot skip straight from discovery to provisioning", () => {
    expect(checkTransition(lead({ state: "DISCOVERED" }), "PROVISIONING", "founder", directive()).ok).toBe(false);
  });
});

describe("pre-sale lock", () => {
  test("agent cannot provision even with a valid directive", () => {
    expect(checkTransition(lead(), "PROVISIONING", "agent", directive())).toEqual({
      ok: false,
      reason: "only the founder can release a deal",
    });
  });
  test("founder without CLOSED_WON is rejected", () => {
    expect(checkTransition(lead({ deal_status: null }), "PROVISIONING", "founder", directive()).ok).toBe(false);
  });
  test("founder without a directive is rejected", () => {
    expect(checkTransition(lead(), "PROVISIONING", "founder", undefined).ok).toBe(false);
  });
  test("directive for another lead is rejected", () => {
    const v = checkTransition(lead(), "PROVISIONING", "founder", directive({ lead_id: "L2" }));
    expect(v).toEqual({ ok: false, reason: "Release Directive is for a different lead" });
  });
  test("directive that allows auto-payments is rejected", () => {
    expect(checkTransition(lead(), "PROVISIONING", "founder", directive({ max_auto_amount: 5000 })).ok).toBe(false);
  });
  test("founder + CLOSED_WON + valid directive passes", () => {
    expect(checkTransition(lead(), "PROVISIONING", "founder", directive())).toEqual({ ok: true });
  });
});

describe("other gates", () => {
  const stageA = (decided: number, accuracyBp: number) => lead({ state: "STAGE_A_SHADOW_MODE", shadow: { decided, accuracyBp } });
  test("stage B needs 50 decided and 95.00% accuracy", () => {
    expect(checkTransition(stageA(50, 9499), "STAGE_B_PRODUCTION_ACTIVE", "founder").ok).toBe(false);
    expect(checkTransition(stageA(49, 10000), "STAGE_B_PRODUCTION_ACTIVE", "founder").ok).toBe(false);
    expect(checkTransition(stageA(50, 9500), "STAGE_B_PRODUCTION_ACTIVE", "agent").ok).toBe(false);
    expect(checkTransition(stageA(50, 9500), "STAGE_B_PRODUCTION_ACTIVE", "founder").ok).toBe(true);
  });
  test("outreach needs score >= 60, booking needs intent >= 70", () => {
    const t = (s: State, over: Partial<LeadGateView>, to: State) => checkTransition(lead({ state: s, ...over }), to, "agent").ok;
    expect(t("DISCOVERED", { score: 59 }, "OUTREACH_ACTIVE")).toBe(false);
    expect(t("DISCOVERED", { score: 60 }, "OUTREACH_ACTIVE")).toBe(true);
    expect(t("SANDBOX_TRIAL", { intent: 69 }, "CALL_BOOKED")).toBe(false);
    expect(t("SANDBOX_TRIAL", { intent: 70 }, "CALL_BOOKED")).toBe(true);
    expect(t("CALL_BOOKED", { brief: null }, "PRE_SALE_HOLD")).toBe(false);
  });
});
