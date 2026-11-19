import { mulDiv } from "./reconcile";

export const ROI_DEFAULTS = { minutesPerInvoice: 12, dsoReductionDays: 4 };
// The demo sample is seeded with ~40% bad invoices, far above real life, so its error rate is NOT projected onto
// the customer's spend. Monthly protection uses a stated, conservative 1% error rate instead.
export const ASSUMED_ERROR_RATE_BP = 100;

export type RoiInput = {
  sampleValue: number; // sum of trial invoice totals (minor units)
  leakage: number; // overbilled amount found in the sample (minor units)
  monthlyInvoices: number;
  monthlyApSpend: number; // minor units
  annualRevenue: number; // minor units
  minutesPerInvoice?: number;
  dsoReductionDays?: number;
};

export function roi(i: RoiInput) {
  const minutesPerInvoice = i.minutesPerInvoice ?? ROI_DEFAULTS.minutesPerInvoice;
  const dsoReductionDays = i.dsoReductionDays ?? ROI_DEFAULTS.dsoReductionDays;
  return {
    hoursSavedPerMonth10: mulDiv(i.monthlyInvoices, minutesPerInvoice * 10, 60), // tenths of an hour
    leakageBp: i.sampleValue ? mulDiv(i.leakage, 10000, i.sampleValue) : 0,
    protectedPerMonth: mulDiv(i.monthlyApSpend, ASSUMED_ERROR_RATE_BP, 10000),
    workingCapitalFreed: mulDiv(dsoReductionDays, i.annualRevenue, 365),
    assumptions: { minutesPerInvoice, dsoReductionDays, errorRateBp: ASSUMED_ERROR_RATE_BP },
  };
}
export type Roi = ReturnType<typeof roi>;
