import { FLAGS, type Flag } from "@/schemas";
import { roundDiv, type Finding } from "./reconcile";

// Compare the agent's read-only decisions to the answer key (in real life: the customer's own AP team).
export function scorecard(findings: Finding[], answerKey: Record<string, Flag[]>, reviewedIds: string[]) {
  const reviewed = new Set(reviewedIds);
  const decidedF = findings.filter((f) => !reviewed.has(f.invoiceId));
  const same = (a: Flag[], b: Flag[]) => a.length === b.length && a.every((x) => b.includes(x));
  const correct = decidedF.filter((f) => same(f.flags, answerKey[f.invoiceId] ?? [])).length;
  const perFlag = FLAGS.map((flag) => {
    let tp = 0, fp = 0, fn = 0;
    for (const f of decidedF) {
      const got = f.flags.includes(flag), want = (answerKey[f.invoiceId] ?? []).includes(flag);
      if (got && want) tp++;
      else if (got) fp++;
      else if (want) fn++;
    }
    return { flag, tp, fp, fn };
  });
  return {
    decided: decidedF.length,
    correct,
    accuracyBp: decidedF.length ? roundDiv(correct * 10000, decidedF.length) : 0,
    reviewed: reviewed.size,
    perFlag,
  };
}
export type Scorecard = ReturnType<typeof scorecard>;
