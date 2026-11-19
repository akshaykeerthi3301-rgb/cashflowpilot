import { z } from "zod";

// ---- Workflow ----
export const STATES = [
  "DISCOVERED",
  "OUTREACH_ACTIVE",
  "SANDBOX_TRIAL",
  "CALL_BOOKED",
  "PRE_SALE_HOLD",
  "PROVISIONING",
  "STAGE_A_SHADOW_MODE",
  "STAGE_B_PRODUCTION_ACTIVE",
  "OPTED_OUT",
  "CLOSED_LOST",
] as const;
export type State = (typeof STATES)[number];
export type Actor = "agent" | "founder";

// ---- Invoice world (money = integer minor units: paise / cents) ----
const money = z.number().int().nonnegative();
export const LineSchema = z.object({
  sku: z.string().min(1),
  hsn: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: money,
  gstRate: z.number().int().min(0).max(28),
  description: z.string().optional(),
});
export const InvoiceSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  supplierId: z.string().min(1),
  supplierState: z.string().min(1),
  buyerState: z.string().min(1),
  poNumber: z.string().min(1),
  date: z.string().min(1),
  currency: z.enum(["INR", "USD"]),
  lines: z.array(LineSchema),
  surcharges: z.array(z.object({ label: z.string(), amount: money })),
  taxTotal: money,
  grandTotal: money,
  raw: z.string().optional(),
  // Present on real documents (working prototype). The engine runs the extra checks only when these exist.
  supplierName: z.string().optional(),
  supplierGstin: z.string().optional(),
  buyerName: z.string().optional(),
  buyerGstin: z.string().optional(),
  taxType: z.enum(["CGST_SGST", "IGST", "NONE"]).optional(),
  roundOff: z.number().int().optional(),
  amountInWords: z.string().optional(),
});
export type Line = z.infer<typeof LineSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type PO = { number: string; supplierId: string; lines: { sku: string; qty: number; unitPrice: number }[] };
export type GRN = { poNumber: string; lines: { sku: string; qtyReceived: number }[] };

export const FLAGS = [
  "QTY_MISMATCH",
  "PRICE_MISMATCH",
  "DUPLICATE_INVOICE",
  "GST_RATE_WRONG",
  "TAX_MATH_ERROR",
  "UNAUTHORIZED_CHARGE",
  "TOTAL_MISMATCH",
  "INVALID_GSTIN",
  "WRONG_TAX_TYPE",
  "WORDS_MISMATCH",
] as const;
export type Flag = (typeof FLAGS)[number];

// ---- Release Directive: the founder's signed permission to provision ----
export const ReleaseDirectiveSchema = z.object({
  lead_id: z.string().min(1),
  signed_by: z.string().trim().min(2),
  signed_at: z.string().min(1),
  deal_value: money.refine((v) => v > 0, "deal value must be > 0"),
  currency: z.enum(["INR", "USD"]),
  scope: z.literal("shadow_only"),
  allowed_systems: z.array(z.enum(["tally", "zoho_books", "quickbooks", "netsuite", "sap_b1", "csv_upload"])).min(1),
  max_auto_amount: z.literal(0), // Stage A never acts on money
  approver_for_stage_b: z.string().trim().min(2),
  notes: z.string().default(""),
});
export type ReleaseDirective = z.infer<typeof ReleaseDirectiveSchema>;

// ---- AI output contracts: every AI result carries confidence + sources ----
const ai = { confidence: z.number().min(0).max(1), source_refs: z.array(z.string()) };
export const SignalsSchema = z.object({
  finance_hiring: z.boolean(),
  recent_funding: z.boolean(),
  fast_growth: z.boolean(),
  ...ai,
});
export const OutreachDraftSchema = z.object({ subject: z.string().min(3), body: z.string().min(20), ...ai });
export const AnswerSchema = z.object({ answer: z.string().min(3), faq_id: z.string().nullable(), ...ai });
export const ExtractedInvoiceSchema = z.object({
  lines: z.array(LineSchema).min(1),
  surcharges: z.array(z.object({ label: z.string(), amount: money })),
  taxTotal: money,
  grandTotal: money,
  ...ai,
});
export const BriefNarrativeSchema = z.object({
  situation: z.string().min(10),
  talking_points: z.array(z.string()).min(1).max(5),
  risks: z.array(z.string()).max(4),
  ...ai,
});
// Working prototype: what a reader (template or AI) returns from a real PDF. Every value is a string EXACTLY as
// printed ("" if absent) — the reader never converts or computes; code does that afterwards.
const printed = z.string();
export const ExtractedDocSchema = z.object({
  invoiceNumber: printed,
  invoiceDate: printed,
  poNumber: printed,
  supplierName: printed,
  supplierGstin: printed,
  buyerGstin: printed,
  placeOfSupplyCode: printed,
  currency: z.enum(["INR", "USD"]),
  lines: z.array(z.object({ sku: printed, description: printed, hsn: printed, qty: printed, rate: printed, gstRate: printed, amount: printed })).min(1),
  charges: z.array(z.object({ label: printed, amount: printed })),
  cgst: printed,
  sgst: printed,
  igst: printed,
  roundOff: printed,
  grandTotal: printed,
  amountInWords: printed,
  confidence: z.number().min(0).max(1),
});
export type ExtractedDoc = z.infer<typeof ExtractedDocSchema>;
export type Signals = z.infer<typeof SignalsSchema>;
export type BriefNarrative = z.infer<typeof BriefNarrativeSchema>;
