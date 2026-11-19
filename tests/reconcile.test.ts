import { describe, expect, test } from "vitest";
import data from "../data/invoices.json";
import { reconcile } from "@/deterministic/reconcile";
import { hydrate } from "@/deterministic/hydrate";
import { scorecard } from "@/deterministic/shadow";
import { mockExtractInvoice } from "@/providers/llm";
import { ExtractedInvoiceSchema, type Flag, type Invoice } from "@/schemas";

for (const name of ["trial", "shadow"] as const) {
  describe(`${name} set vs answer key`, () => {
    const set = data[name] as unknown as { invoices: Invoice[]; pos: never[]; grns: never[]; answerKey: Record<string, Flag[]>; smudged: string[] };
    const reviewed: string[] = [];
    const batch = set.invoices.flatMap((inv) => {
      if (!inv.raw) return [inv];
      const ex = ExtractedInvoiceSchema.safeParse(mockExtractInvoice(inv.raw));
      if (!ex.success || ex.data.confidence < 0.7) return reviewed.push(inv.id), [];
      return [hydrate(inv, ex.data)];
    });
    const findings = reconcile(batch, set.pos, set.grns);

    test("every planted defect is found and no clean invoice is flagged", () => {
      for (const f of findings) expect([...f.flags].sort(), f.invoiceId).toEqual([...set.answerKey[f.invoiceId]].sort());
    });
    test("exactly the smudged text invoices go to human review", () => {
      expect(reviewed.sort()).toEqual([...set.smudged].sort());
    });
    test("scorecard: 57 decided, 100.00% accuracy", () => {
      expect(scorecard(findings, set.answerKey, reviewed)).toMatchObject({ decided: 57, accuracyBp: 10000, reviewed: 3 });
    });
    test("clean invoices are not overbilled; defective ones mostly are", () => {
      for (const f of findings) if (!f.flags.length) expect(f.overbilled, f.invoiceId).toBe(0);
    });
  });
}
