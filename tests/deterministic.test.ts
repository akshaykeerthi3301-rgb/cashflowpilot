import { beforeEach, describe, expect, test } from "vitest";
import { lineTax, mulDiv, roundDiv } from "@/deterministic/reconcile";
import { roi } from "@/deterministic/roi";
import { intentScore, scoreLead, type Company } from "@/deterministic/scoring";
import { bumpUsage, canSend, withBackoff } from "@/deterministic/limits";
import { query, resetDbForTests } from "@/db";

describe("GST math (to the paisa)", () => {
  test("intra-state splits into CGST + SGST, each rounded", () => {
    expect(lineTax(100000, 18, true)).toEqual({ cgst: 9000, sgst: 9000, igst: 0, total: 18000 });
    expect(lineTax(12347, 5, true)).toEqual({ cgst: 309, sgst: 309, igst: 0, total: 618 }); // 308.675 -> 309 each
  });
  test("inter-state is IGST at full rate", () => {
    expect(lineTax(12347, 5, false)).toEqual({ cgst: 0, sgst: 0, igst: 617, total: 617 }); // 617.35 -> 617
  });
  test("rounding helpers are exact on huge numbers", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(mulDiv(4_000_000_000, 250_000, 10_000_000)).toBe(100_000_000); // would overflow as a double product
    expect(() => roundDiv(1.5, 2)).toThrow();
  });
});

test("ROI fixture", () => {
  const r = roi({
    sampleValue: 10_000_000,
    leakage: 250_000,
    monthlyInvoices: 800,
    monthlyApSpend: 4_000_000_000,
    annualRevenue: 36_500_000_000,
  });
  expect(r).toMatchObject({
    hoursSavedPerMonth10: 1600, // 160.0 h
    leakageBp: 250, // 2.50%
    protectedPerMonth: 40_000_000, // 1% of Rs 4 crore = Rs 4 lakh
    workingCapitalFreed: 400_000_000, // 4 days x Rs 365 cr / 365
  });
});

describe("lead score", () => {
  const c: Company = {
    id: "c", name: "X", industry: "saas", employees: 200, region: "IN", erp: "tally", blurb: "",
    monthlyInvoices: 1, monthlyApSpend: 1, annualRevenue: 1, currency: "INR", suppliers: [], persona: "eager",
    contact: { name: "A", role: "CFO", email: "a@x.example" },
  };
  const sig = { finance_hiring: true, recent_funding: true, fast_growth: true, source_refs: [] };
  test("perfect fit scores 100", () => expect(scoreLead(c, { ...sig, confidence: 0.9 }).score).toBe(100));
  test("low-confidence AI signals are ignored", () => expect(scoreLead(c, { ...sig, confidence: 0.69 }).score).toBe(75));
});

test("intent caps repeated events", () => {
  expect(intentScore(["trial_opened", "question_asked", "question_asked", "question_asked"])).toBe(40);
});

describe("circuit breakers", () => {
  beforeEach(resetDbForTests);
  test("21st send in a day is blocked", async () => {
    for (let i = 0; i < 20; i++) expect((await canSend("w", `p${i}@x.example`)).ok).toBe(true);
    expect(await canSend("w", "p21@x.example")).toEqual({ ok: false, reason: "daily cold-email cap reached" });
  });
  test("thread replies don't use the cold-email cap", async () => {
    for (let i = 0; i < 20; i++) await canSend("w", `p${i}@x.example`);
    expect(await canSend("w", "p1@x.example", { cold: false })).toEqual({ ok: true });
  });
  test("opted-out contact is blocked before the cap is touched", async () => {
    await query("INSERT INTO opt_outs VALUES ('w','gone@x.example')");
    expect(await canSend("w", "GONE@x.example")).toEqual({ ok: false, reason: "contact opted out" });
  });
  test("usage limit is per key", async () => {
    expect(await bumpUsage("w", "a", 1)).toBe(true);
    expect(await bumpUsage("w", "a", 1)).toBe(false);
    expect(await bumpUsage("w", "b", 1)).toBe(true);
  });
  test("backoff retries 3 times then gives up", async () => {
    let calls = 0;
    const waits: number[] = [];
    await expect(
      withBackoff(async () => { calls++; throw new Error("down"); }, { sleep: async (ms) => void waits.push(ms) }),
    ).rejects.toThrow("down");
    expect(calls).toBe(4);
    expect(waits).toEqual([250, 500, 1000]);
  });
});
