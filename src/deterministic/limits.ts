import { query } from "@/db";

export const LIMITS = { dailySendsPerWorkspace: 20, aiCallsPerLead: 30, realAiCallsPerDay: 300, retries: 3 } as const;

const today = () => new Date().toISOString().slice(0, 10);

// Atomic "increment if under limit". Returns false once the limit is reached (circuit breaker trips).
export async function bumpUsage(scope: string, key: string, limit: number, perDay = true): Promise<boolean> {
  const rows = await query(
    `INSERT INTO usage (scope, day, key, count) VALUES ($1,$2,$3,1)
     ON CONFLICT (scope, day, key) DO UPDATE SET count = usage.count + 1 WHERE usage.count < $4
     RETURNING count`,
    [scope, perDay ? today() : "all", key, limit],
  );
  return rows.length > 0;
}

// Opt-outs block every email. The daily cap counts only cold first-touch emails (what hurts sender
// reputation); replies inside a thread the buyer already answered don't use it up.
export async function canSend(ws: string, email: string, { cold = true } = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const opted = await query("SELECT 1 FROM opt_outs WHERE workspace_id=$1 AND email=$2", [ws, email.toLowerCase()]);
  if (opted.length) return { ok: false, reason: "contact opted out" };
  if (cold && !(await bumpUsage(ws, "sends", LIMITS.dailySendsPerWorkspace))) return { ok: false, reason: "daily cold-email cap reached" };
  return { ok: true };
}

// Retries with exponential backoff. If the provider says how long to wait (rate limit), wait exactly that —
// but never longer in total than maxWaitMs (a live web request can't wait minutes; a batch script can).
export async function withBackoff<T>(
  fn: () => Promise<T>,
  { retries = LIMITS.retries, baseMs = 250, maxWaitMs = Infinity, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let attempt = 0, waited = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const hinted = (err as { retryAfterMs?: number }).retryAfterMs;
      const wait = hinted ?? baseMs * 2 ** attempt;
      if ((hinted === undefined && attempt >= retries) || attempt >= 30 || waited + wait > maxWaitMs) throw err;
      waited += wait;
      await sleep(wait);
    }
  }
}
