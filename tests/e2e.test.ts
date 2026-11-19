import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { query, resetDbForTests } from "@/db";
import { createWorkspace, resetWorkspace, workspaceExists } from "@/workspace";
import { research } from "@/agents/researcher";
import { advance } from "@/agents/advance";
import { agentTryProvision, founderCloseWon, promoteStageB } from "@/agents/provisioner_shadow";
import { getLead } from "@/agents/common";
import { extractSignals } from "@/providers/llm";
import { COMPANIES } from "@/agents/common";
import { parseInvoiceCsv } from "@/deterministic/csv";
import { reconcile } from "@/deterministic/reconcile";

let ws: string;
beforeEach(async () => {
  await resetDbForTests();
  ws = await createWorkspace();
  await research(ws);
});

async function runTo(id: string, steps = 10) {
  for (let i = 0; i < steps; i++) {
    const r = await advance(ws, id);
    if (r.state === "PRE_SALE_HOLD") break;
  }
  return (await getLead(ws, id))!;
}
const outbox = (id: string, dir: string, w = ws) =>
  query<{ subject: string; body: string }>("SELECT subject, body FROM outbox WHERE workspace_id=$1 AND lead_id=$2 AND direction=$3", [w, id, dir]);
const directive = (lead_id: string, over: Record<string, unknown> = {}) => ({
  lead_id, signed_by: "Demo Founder", signed_at: "2026-11-19", deal_value: 120000000, currency: "INR",
  scope: "shadow_only", allowed_systems: ["zoho_books"], max_auto_amount: 0, approver_for_stage_b: "Demo Founder", ...over,
});

describe("full journey", () => {
  test("eager lead: DISCOVERED -> PRE_SALE_HOLD, then stops", async () => {
    const lead = await runTo("brightloop");
    expect(lead.state).toBe("PRE_SALE_HOLD");
    expect(lead.brief?.facts.flagged).toBe(String(lead.trial!.flagged));
    expect(lead.call_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await advance(ws, "brightloop")).did).toMatch(/LOCKED/);
  });

  test("the lock: agent rejected, bad directive rejected, founder releases into shadow mode, then stage B", async () => {
    await runTo("brightloop");
    expect(await agentTryProvision(ws, "brightloop")).toEqual({ ok: false, reason: "only the founder can release a deal" });
    const rejected = await query("SELECT 1 FROM audit WHERE workspace_id=$1 AND action='transition.rejected'", [ws]);
    expect(rejected.length).toBeGreaterThan(0);

    const bad = await founderCloseWon(ws, "brightloop", directive("brightloop", { signed_by: "" }));
    expect(bad.ok).toBe(false);
    expect((await getLead(ws, "brightloop"))!.state).toBe("PRE_SALE_HOLD");
    const otherLead = await founderCloseWon(ws, "brightloop", directive("kaveri"));
    expect(otherLead).toEqual({ ok: false, errors: ["Release Directive is for a different lead"] });

    expect(await founderCloseWon(ws, "brightloop", directive("brightloop"))).toEqual({ ok: true });
    const lead = (await getLead(ws, "brightloop"))!;
    expect(lead.state).toBe("STAGE_A_SHADOW_MODE");
    expect(lead.shadow).toMatchObject({ decided: 57, accuracyBp: 10000, reviewed: 3 });
    expect(await promoteStageB(ws, "brightloop")).toEqual({ ok: true });
  });

  test("skeptical buyer gets an answer from the approved FAQ, then converts", async () => {
    const lead = await runTo("swiftmile");
    expect(lead.state).toBe("PRE_SALE_HOLD");
    const sent = await outbox("swiftmile", "out");
    expect(sent.some((m) => m.body.includes("isolated sandbox"))).toBe(true);
  });

  test("opt-out: suppressed and never emailed again", async () => {
    await runTo("fernhill");
    expect((await getLead(ws, "fernhill"))!.state).toBe("OPTED_OUT");
    expect((await outbox("fernhill", "out")).length).toBe(1);
    expect(await query("SELECT 1 FROM opt_outs WHERE workspace_id=$1 AND email='lakshmi@fernhill.example'", [ws])).toHaveLength(1);
  });

  test("gates hold: low score not contacted, lukewarm stays in trial, silent waits", async () => {
    expect((await runTo("quillstone")).state).toBe("DISCOVERED");
    expect(await outbox("quillstone", "out")).toHaveLength(0);
    const luke = await runTo("pixelmint");
    expect(luke.state).toBe("SANDBOX_TRIAL");
    expect(luke.intent).toBe(30);
    expect((await runTo("orbit")).state).toBe("OUTREACH_ACTIVE");
  });

  test("vague company description goes to human review instead of being guessed", async () => {
    const r = await query<{ reason: string }>("SELECT reason FROM review_queue WHERE workspace_id=$1 AND lead_id='granite'", [ws]);
    expect(r[0].reason).toMatch(/Signals unclear/);
  });
});

describe("visitor run (stage API)", () => {
  test("five stages take the hero to the lock with real, consistent numbers", async () => {
    const { runStage } = await import("@/agents/run");
    const r = (await runStage(ws, "research")) as { companies: { fit: boolean }[] };
    expect(r.companies).toHaveLength(12);
    expect(r.companies.filter((c) => !c.fit)).toHaveLength(2);
    const o = (await runStage(ws, "outreach")) as { emails: unknown[]; skipped: number };
    expect([o.emails.length, o.skipped]).toEqual([10, 2]);
    const rep = (await runStage(ws, "replies")) as { qualified: string[]; replies: { outcome: string }[] };
    expect(rep.qualified).toHaveLength(8);
    expect(rep.replies.filter((x) => x.outcome === "unsubscribed")).toHaveLength(1);
    expect(rep.replies.filter((x) => x.outcome === "convinced")).toHaveLength(2);
    const t = (await runStage(ws, "trial")) as { invoices: { status: string }[]; flagged: number };
    expect(t.invoices).toHaveLength(24); // 23 checked by code + 1 too smudged to read => a person
    expect(t.invoices.filter((i) => i.status === "review")).toHaveLength(1);
    expect(t.flagged).toBe(9);
    expect(t.invoices.filter((i) => i.status === "flagged")).toHaveLength(9);
    const b = (await runStage(ws, "book")) as { locked: string[]; hero: { state: string; protectedPerMonth: string } };
    expect(b.hero.state).toBe("PRE_SALE_HOLD");
    expect(b.hero.protectedPerMonth).toBe("₹6.0L"); // 1% of ₹6 Cr monthly spend
    expect(b.locked).toHaveLength(6);
  });
});

describe("circuit breakers and safety", () => {
  test("daily send cap blocks outreach and the lead does not advance", async () => {
    await query("INSERT INTO usage VALUES ($1, to_char(now() at time zone 'utc','YYYY-MM-DD'), 'sends', 20)", [ws]);
    const r = await advance(ws, "brightloop");
    expect(r).toEqual({ did: "blocked: daily cold-email cap reached", state: "DISCOVERED" });
  });

  test("double-click advance sends exactly one email", async () => {
    await Promise.all([advance(ws, "kaveri"), advance(ws, "kaveri")]);
    expect(await outbox("kaveri", "out")).toHaveLength(1);
  });

  test("workspaces are isolated; forged ids are rejected", async () => {
    const other = await createWorkspace();
    await runTo("brightloop");
    expect(await outbox("brightloop", "out", other)).toHaveLength(0);
    expect(await workspaceExists("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await workspaceExists("x'; drop table leads;--")).toBe(false);
    await resetWorkspace(ws);
    expect(await query("SELECT 1 FROM leads WHERE workspace_id=$1", [ws])).toHaveLength(0);
  });
});

describe("AI boundary", () => {
  beforeEach(() => void (process.env.DEMO_LIVE_AI = "on")); // these tests exercise the live-model path on purpose
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEMO_LIVE_AI;
  });
  const reply = (text: string) =>
    new Response(
      JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const c = COMPANIES[0];

  test("the simulated sales demo never calls a real model, even with a key set", async () => {
    delete process.env.DEMO_LIVE_AI;
    process.env.ANTHROPIC_API_KEY = "test";
    const spy = vi.fn(async () => reply("{}"));
    vi.stubGlobal("fetch", spy);
    const r = await extractSignals({ ws, leadId: null }, c);
    expect(r.source).toBe("mock");
    expect(spy).not.toHaveBeenCalled();
  });

  test("31st AI call for a lead never reaches the paid model", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const fetchSpy = vi.fn(async () => reply("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await query("UPDATE usage SET count=30 WHERE scope=$1 AND key='ai:brightloop'", [ws]);
    const r = await extractSignals({ ws, leadId: "brightloop" }, c);
    expect(r.source).toBe("mock");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await query("SELECT 1 FROM audit WHERE workspace_id=$1 AND action='ai.budget_exhausted'", [ws])).toHaveLength(1);
  });

  test("model returning low confidence is routed to review, not used", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () =>
      reply(JSON.stringify({ finance_hiring: true, recent_funding: true, fast_growth: true, confidence: 0.2, source_refs: [] })),
    ));
    const r = await extractSignals({ ws, leadId: null }, c);
    expect(r).toMatchObject({ ok: false, source: "model" });
  });

  test("model returning garbage does not crash the step", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => reply("not json at all")));
    const r = await extractSignals({ ws, leadId: null }, c);
    expect(r).toMatchObject({ ok: true, source: "mock" }); // unparseable output => retried, then safe fallback
    expect(await query("SELECT 1 FROM audit WHERE workspace_id=$1 AND action='ai.model_failed'", [ws])).toHaveLength(1);
  }, 60000);

  test("model outage falls back to the deterministic mock after retries", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const r = await extractSignals({ ws, leadId: null }, c);
    expect(r.source).toBe("mock");
    expect(await query("SELECT 1 FROM audit WHERE workspace_id=$1 AND action='ai.model_failed'", [ws])).toHaveLength(1);
  }, 60000);
});

describe("CSV upload", () => {
  test("sample upload finds GST, duplicate and tax errors without POs", () => {
    const p = parseInvoiceCsv(readFileSync("public/sample-upload.csv", "utf8"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(reconcile(p.invoices, [], [], { poChecks: false }).map((f) => f.flags)).toEqual([
      [], ["GST_RATE_WRONG"], ["DUPLICATE_INVOICE"], ["TAX_MATH_ERROR"],
    ]);
  });
  test("bad rows are reported with row numbers and nothing is used", () => {
    const head = readFileSync("public/sample-upload.csv", "utf8").split("\n")[0];
    const p = parseInvoiceCsv(`${head}\nA,S,2026-01-01,INR,KA,KA,X,8471,1,12.5,18,0.00,1.00,2.00\nB,S,d,INR,KA,KA,X,8471,1`);
    expect(p).toEqual({ ok: false, errors: ["row 2: amounts must look like 1234.50", "row 3: expected 14 columns, got 9"] });
    expect(parseInvoiceCsv("wrong,header")).toMatchObject({ ok: false });
  });
});
