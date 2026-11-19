import { query } from "@/db";
import companies from "../../data/companies.json";
import invoiceData from "../../data/invoices.json";
import type { Company } from "@/deterministic/scoring";
import type { Flag, GRN, Invoice, PO, State } from "@/schemas";

export type Lead = {
  workspace_id: string;
  id: string;
  company_id: string;
  name: string;
  industry: string;
  region: string;
  persona: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  state: State;
  score: number;
  score_breakdown: unknown;
  intent: number;
  trial: Trial | null;
  brief: Brief | null;
  call_at: string | null;
  deal_status: string | null;
  shadow: import("@/deterministic/shadow").Scorecard | null;
};
export type Trial = {
  currency: "INR" | "USD";
  invoiceCount: number;
  reviewed: string[];
  findings: import("@/deterministic/reconcile").Finding[];
  flagged: number;
  leakage: number;
  sampleValue: number;
  roi: import("@/deterministic/roi").Roi;
  qa: { q: string; a: string; source: string }[];
  events: string[];
  pitch: string;
};
export type Brief = { facts: Record<string, string>; narrative: import("@/schemas").BriefNarrative; source: string };

export type InvoiceSet = { invoices: Invoice[]; pos: PO[]; grns: GRN[]; answerKey: Record<string, Flag[]>; smudged: string[] };
export const DATA = invoiceData as unknown as { suppliers: { id: string; name: string }[]; trial: InvoiceSet; shadow: InvoiceSet };
export const COMPANIES = companies as Company[];
export const company = (id: string) => COMPANIES.find((c) => c.id === id)!;

export async function getLead(ws: string, id: string): Promise<Lead | null> {
  const [l] = await query<Lead>("SELECT * FROM leads WHERE workspace_id=$1 AND id=$2", [ws, id]);
  return l ?? null;
}

export async function toReview(ws: string, leadId: string, reason: string, payload: unknown = {}) {
  await query("INSERT INTO review_queue (workspace_id, lead_id, reason, payload) VALUES ($1,$2,$3,$4)", [ws, leadId, reason, JSON.stringify(payload)]);
}

export async function mail(ws: string, leadId: string, direction: "out" | "in", subject: string, body: string) {
  await query("INSERT INTO outbox (workspace_id, lead_id, direction, subject, body) VALUES ($1,$2,$3,$4,$5)", [ws, leadId, direction, subject, body]);
}

// Display only: integer split, no float arithmetic on money.
export function fmtMoney(minor: number, currency: "INR" | "USD"): string {
  const whole = Math.floor(minor / 100), cents = String(minor % 100).padStart(2, "0");
  return `${currency === "INR" ? "₹" : "$"}${whole.toLocaleString(currency === "INR" ? "en-IN" : "en-US")}.${cents}`;
}

// Compact display: ₹25.8L, ₹3.07 Cr, $1.2M. Display only.
export function fmtShort(minor: number, currency: "INR" | "USD"): string {
  const units = minor / 100;
  if (currency === "INR") {
    if (units >= 1e7) return `₹${(units / 1e7).toFixed(2)} Cr`;
    if (units >= 1e5) return `₹${(units / 1e5).toFixed(1)}L`;
    return `₹${Math.round(units).toLocaleString("en-IN")}`;
  }
  if (units >= 1e6) return `$${(units / 1e6).toFixed(2)}M`;
  if (units >= 1e3) return `$${(units / 1e3).toFixed(1)}K`;
  return `$${Math.round(units).toLocaleString("en-US")}`;
}

export const FLAG_LABEL: Record<string, string> = {
  QTY_MISMATCH: "Billed for goods not received",
  PRICE_MISMATCH: "Charged more than the PO",
  DUPLICATE_INVOICE: "Billed twice",
  GST_RATE_WRONG: "Wrong GST rate",
  TAX_MATH_ERROR: "Tax doesn't add up",
  UNAUTHORIZED_CHARGE: "Charge not on the PO",
  TOTAL_MISMATCH: "Total doesn't add up",
  INVALID_GSTIN: "Supplier GST number is invalid",
  WRONG_TAX_TYPE: "Wrong tax type for the state",
  WORDS_MISMATCH: "Amount in words doesn't match",
};
