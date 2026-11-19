import type { Signals } from "@/schemas";

export const CONFIDENCE_MIN = 0.7;
export const TARGET_ROLES = ["CFO", "VP Finance", "Financial Controller", "AP/AR Lead"];

export type Company = {
  id: string;
  name: string;
  industry: string;
  employees: number;
  region: string;
  erp: string;
  blurb: string;
  monthlyInvoices: number;
  monthlyApSpend: number;
  annualRevenue: number;
  currency: "INR" | "USD";
  suppliers: string[];
  persona: string;
  contact: { name: string; role: string; email: string };
};
export type ScoreLine = { factor: string; points: number; max: number; why: string };

export function scoreLead(c: Company, s: Signals | null) {
  const lines: ScoreLine[] = [];
  const add = (factor: string, points: number, max: number, why: string) => lines.push({ factor, points, max, why });

  add("Industry", ["saas", "d2c", "logistics", "manufacturing"].includes(c.industry) ? 20 : 5, 20, c.industry);
  const e = c.employees;
  add("Size", e >= 50 && e <= 500 ? 20 : e > 500 && e <= 2000 ? 15 : e > 2000 ? 8 : 5, 20, `${e} employees`);
  add("Region", c.region === "IN" ? 15 : 10, 15, c.region);
  add("ERP", ["tally", "zoho_books", "quickbooks", "netsuite"].includes(c.erp) ? 15 : c.erp === "sap_b1" ? 8 : 3, 15, c.erp);

  const trusted = s && s.confidence >= CONFIDENCE_MIN; // below threshold: ignore AI signals entirely
  add("Finance hiring", trusted && s.finance_hiring ? 10 : 0, 10, trusted ? "AI-read signal" : "no trusted signal");
  add("Recent funding", trusted && s.recent_funding ? 10 : 0, 10, trusted ? "AI-read signal" : "no trusted signal");
  add("Fast growth", trusted && s.fast_growth ? 5 : 0, 5, trusted ? "AI-read signal" : "no trusted signal");
  add("Decision-maker", TARGET_ROLES.includes(c.contact.role) ? 5 : 0, 5, c.contact.role);

  return { score: lines.reduce((t, l) => t + l.points, 0), breakdown: lines };
}

// Buying intent from trial activity. Pure counting, no AI.
export const INTENT_POINTS: Record<string, { points: number; cap: number }> = {
  trial_opened: { points: 10, cap: 10 },
  file_uploaded: { points: 20, cap: 20 },
  roi_viewed: { points: 20, cap: 20 },
  question_asked: { points: 15, cap: 30 },
  return_visit: { points: 10, cap: 20 },
};
export function intentScore(events: string[]): number {
  let total = 0;
  for (const [kind, { points, cap }] of Object.entries(INTENT_POINTS))
    total += Math.min(cap, events.filter((e) => e === kind).length * points);
  return total;
}
