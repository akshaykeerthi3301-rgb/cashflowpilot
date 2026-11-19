// The ONLY place AI is called. Every task: budget check -> (real model | deterministic mock) -> Zod validation
// -> confidence threshold. Callers get ok:false for anything they must route to human review.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z as zod, type z } from "zod";
import faq from "../../data/faq.json";
import { audit } from "@/state_machine";
import { bumpUsage, LIMITS, withBackoff } from "@/deterministic/limits";
import { CONFIDENCE_MIN, type Company } from "@/deterministic/scoring";
import {
  AnswerSchema,
  BriefNarrativeSchema,
  ExtractedDocSchema,
  ExtractedInvoiceSchema,
  OutreachDraftSchema,
  SignalsSchema,
} from "@/schemas";

type Ctx = { ws: string; leadId: string | null };
export type AiResult<T> =
  | { ok: true; data: T; source: "mock" | "model"; model?: string }
  | { ok: false; reason: string; data?: T; source: "mock" | "model"; model?: string };
type ModelInput = { system: string; user: string; imageB64?: string; pdfB64?: string };

// Which AI is switched on. Default: Groq if its key is set, else Claude if its key is set, else none (simulator).
export function aiProvider(): "groq" | "anthropic" | null {
  const want = process.env.LLM_PROVIDER;
  if (want === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (want === "groq") return process.env.GROQ_API_KEY ? "groq" : null;
  return process.env.GROQ_API_KEY ? "groq" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
}
export function modelName(input: { imageB64?: string } = {}): string {
  if (aiProvider() === "groq")
    return input.imageB64 ? process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b" : process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
  return process.env.LLM_MODEL || "claude-haiku-5-5";
}

async function callClaude<S extends z.ZodType>(schema: S, input: ModelInput): Promise<unknown> {
  const model = modelName();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.pdfB64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdfB64 } });
  else if (input.imageB64) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.imageB64 } });
  content.push({ type: "text", text: input.user });
  // Server-side refusal fallback exists only for the larger models; Haiku has none.
  const fallback = /opus|sonnet|fable/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  const res = await new Anthropic({ maxRetries: 0 }).beta.messages.parse({
    model,
    max_tokens: 4000,
    output_config: { format: betaZodOutputFormat(schema) },
    ...fallback,
    system: input.system,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  return res.parsed_output;
}

async function callGroq<S extends z.ZodType>(schema: S, input: ModelInput): Promise<unknown> {
  const vision = !!input.imageB64;
  const model = modelName(input);
  const { $schema: _drop, ...jsonSchema } = zod.toJSONSchema(schema) as Record<string, unknown>;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      // Vision models take JSON mode with the schema in the prompt; text models take the schema directly.
      response_format: vision ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "result", schema: jsonSchema } },
      messages: [
        { role: "system", content: vision ? `${input.system}\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` : input.system },
        { role: "user", content: vision ? [{ type: "text", text: input.user }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.imageB64}` } }] : input.user },
      ],
    }),
  });
  if (!res.ok) {
    const err = Object.assign(new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`), {} as { retryAfterMs?: number });
    if (res.status === 429) {
      const after = res.headers.get("retry-after");
      err.retryAfterMs = (after ? Number(after) * 1000 : parseDuration(res.headers.get("x-ratelimit-reset-tokens"))) ?? 5000;
    }
    throw err;
  }
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(j.choices[0].message.content);
}

// "32.4s" | "1m26.4s" | "577ms" -> milliseconds
export function parseDuration(s: string | null): number | undefined {
  const m = s && /^(?:(\d+)m)?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(s.trim());
  if (!m || !s) return undefined;
  return Math.ceil(Number(m[1] ?? 0) * 60000 + Number(m[2] ?? 0) * 1000 + Number(m[3] ?? 0));
}

// Only the working prototype calls a real model. The sales demo is simulated by design (the README says so) and
// must not spend the shared AI quota; DEMO_LIVE_AI=on lets it use the model too.
const LIVE_TASKS = new Set(["extract_document"]);
const liveAllowed = (task: string) => LIVE_TASKS.has(task) || process.env.DEMO_LIVE_AI === "on";

const callModel = <S extends z.ZodType>(schema: S, input: ModelInput) =>
  aiProvider() === "groq" ? callGroq(schema, input) : callClaude(schema, input);

export async function runTask<S extends z.ZodType<{ confidence: number }>>(
  task: string,
  schema: S,
  ctx: Ctx,
  prompt: ModelInput,
  mock: () => unknown,
  extraCheck?: (d: z.infer<S>) => string | null,
): Promise<AiResult<z.infer<S>>> {
  // Circuit breakers: per-lead budget (all calls), then a global daily cap on real model calls.
  const withinLead = ctx.leadId ? await bumpUsage(ctx.ws, `ai:${ctx.leadId}`, LIMITS.aiCallsPerLead, false) : true;
  if (!withinLead) await audit(ctx.ws, ctx.leadId, "system", "ai.budget_exhausted", { task });
  const useModel = withinLead && liveAllowed(task) && !!aiProvider() && (await bumpUsage("global", "ai_real", LIMITS.realAiCallsPerDay));

  let raw: unknown, source: "mock" | "model" = "mock";
  const model = useModel ? modelName(prompt) : undefined;
  if (useModel) {
    try {
      raw = await withBackoff(() => callModel(schema, prompt), { maxWaitMs: Number(process.env.AI_MAX_WAIT_MS ?? 8000) });
      source = "model";
    } catch (err) {
      await audit(ctx.ws, ctx.leadId, "system", "ai.model_failed", { task, error: String(err).slice(0, 200) });
      raw = mock();
    }
  } else raw = mock();

  const parsed = schema.safeParse(raw);
  await audit(ctx.ws, ctx.leadId, "agent", "ai.call", { task, source, model, valid: parsed.success });
  const m = source === "model" ? model : undefined;
  if (!parsed.success) return { ok: false, reason: "AI output failed schema validation", source, model: m };
  const data = parsed.data as z.infer<S>;
  const extra = extraCheck?.(data);
  if (extra) return { ok: false, reason: extra, data, source, model: m };
  if (data.confidence < CONFIDENCE_MIN) return { ok: false, reason: `low confidence ${data.confidence}`, data, source, model: m };
  return { ok: true, data, source, model: m };
}

// ---------- tasks ----------

export function extractSignals(ctx: Ctx, c: Company) {
  return runTask(
    "extract_signals",
    SignalsSchema,
    ctx,
    {
      system: "You read short company descriptions and report buying signals for accounts-payable automation. Only report what the text states. Lower confidence when the text is vague.",
      user: `Company: ${c.name}\nDescription: ${c.blurb}`,
    },
    () => {
      const b = c.blurb.toLowerCase();
      return {
        finance_hiring: /hiring|openings|posted/.test(b) && /financ|account|ap |payable|ap associate/.test(b),
        recent_funding: /series|raised|funding|round/.test(b),
        fast_growth: /grew|growth|growing|doubled|expanding/.test(b),
        confidence: b.length >= 60 ? 0.9 : 0.5,
        source_refs: ["company.blurb"],
      };
    },
  );
}

export function draftOutreach(ctx: Ctx, c: Company, hook: string) {
  const first = c.contact.name.split(" ")[0];
  return runTask(
    "draft_outreach",
    OutreachDraftSchema,
    ctx,
    {
      system:
        "You write short, plain B2B outreach emails (under 120 words) from a founder. Offer a zero-risk sandbox trial: sample data or uploaded files only, no ERP/bank access. No invented numbers. End with an opt-out line.",
      user: `Recipient: ${c.contact.name}, ${c.contact.role} at ${c.name} (${c.industry}). Why now: ${hook}`,
    },
    () => ({
      subject: `${c.name}: catch invoice mismatches before you pay them`,
      body:
        `Hi ${first},\n\nI read this about ${c.name}: "${hook}." Growth like that is usually when manual three-way matching starts to hurt.\n\n` +
        `CashFlowPilot matches invoices against POs and goods receipts, re-checks GST to the paisa and flags duplicates. ` +
        `You can try it in an isolated sandbox with sample data or your own export — it never touches your ERP, bank or payments.\n\n` +
        `Worth a 10-minute look?\n\n— Founder, CashFlowPilot\n\nReply "unsubscribe" and I won't email again.`,
      confidence: 0.95,
      source_refs: ["company.blurb", "lead.score"],
    }),
  );
}

export function answerQuestion(ctx: Ctx, question: string) {
  return runTask(
    "answer_question",
    AnswerSchema,
    ctx,
    {
      system:
        "Answer the prospect's question ONLY from the approved FAQ below. If the FAQ does not cover it, set faq_id to null and confidence below 0.5.\n\n" +
        JSON.stringify(faq),
      user: question,
    },
    () => {
      const words = question.toLowerCase().split(/[^a-z0-9]+/);
      const best = faq
        .map((f) => ({ f, hits: f.keywords.filter((k) => words.includes(k)).length }))
        .sort((a, b) => b.hits - a.hits)[0];
      if (!best || best.hits === 0)
        return { answer: "Good question — I'll get the founder to answer that one personally.", faq_id: null, confidence: 0.3, source_refs: [] };
      return { answer: best.f.answer, faq_id: best.f.id, confidence: best.hits >= 2 ? 0.92 : 0.78, source_refs: [`faq.${best.f.id}`] };
    },
    (d) => (d.faq_id && !faq.some((f) => f.id === d.faq_id) ? "answer cites a FAQ entry that does not exist" : null),
  );
}

// Parse "1,23,450.00" (Indian or Western grouping) into minor units without floating point.
export function parseMoney(s: string): number | null {
  const m = /^(\d[\d,]*)\.(\d{2})$/.exec(s.trim());
  return m ? Number(m[1].replaceAll(",", "")) * 100 + Number(m[2]) : null;
}

export function mockExtractInvoice(raw: string) {
  const lines: unknown[] = [];
  let unreadable = 0;
  for (const l of raw.split("\n").filter((x) => x.startsWith("- "))) {
    const m = /^- (\S+) \| HSN (\S+) \| Qty (\d+) \| Rate ([\d,]+\.\d{2}) \| GST (\d+)%$/.exec(l);
    if (!m) {
      unreadable++;
      continue;
    }
    lines.push({ sku: m[1], hsn: m[2], qty: Number(m[3]), unitPrice: parseMoney(m[4]), gstRate: Number(m[5]) });
  }
  const surcharges = [...raw.matchAll(/^Surcharge: (.+) ([\d,]+\.\d{2})$/gm)].map((m) => ({ label: m[1], amount: parseMoney(m[2]) }));
  const tax = parseMoney(/Tax total: ([\d,]+\.\d{2})/.exec(raw)?.[1] ?? "");
  const grand = parseMoney(/Grand total: ([\d,]+\.\d{2})/.exec(raw)?.[1] ?? "");
  return {
    lines,
    surcharges,
    taxTotal: tax ?? 0,
    grandTotal: grand ?? 0,
    confidence: unreadable || tax === null || grand === null ? 0.3 : 0.9,
    source_refs: ["invoice.raw"],
  };
}

export function extractInvoice(ctx: Ctx, raw: string) {
  return runTask(
    "extract_invoice",
    ExtractedInvoiceSchema,
    ctx,
    {
      system:
        "Extract invoice line items exactly as printed. Amounts in minor units (paise/cents) as integers. Never compute or correct totals — copy them. If any field is illegible, set confidence below 0.5.",
      user: raw,
    },
    () => mockExtractInvoice(raw),
  );
}

// The narrative may only repeat numbers the code computed. Any other number => rejected.
export function writeBrief(ctx: Ctx, facts: Record<string, string>, persona: string) {
  const allowed = Object.values(facts).join(" ");
  return runTask(
    "write_brief",
    BriefNarrativeSchema,
    ctx,
    {
      system:
        "Write a pre-call brief for a founder. Use ONLY the facts given; copy numbers exactly as written; do not compute anything new.",
      user: JSON.stringify({ facts, buyer_style: persona }),
    },
    () => ({
      situation: `${facts.company} (${facts.industry}) ran the sandbox trial on ${facts.invoices} invoices and saw ${facts.flagged} flagged, worth ${facts.leakage} in overbilling.`,
      talking_points: [
        `At a conservative ${facts.error_rate} error rate, ${facts.protected_per_month} a month is protected.`,
        `Hours saved on matching: ${facts.hours_saved} per month.`,
        `Working capital freed by a ${facts.dso_days}-day DSO cut: ${facts.working_capital}.`,
        `Shadow Mode first: read-only until accuracy is proven on their own invoices.`,
      ],
      risks:
        persona === "skeptical"
          ? ["Asked about security in writing — lead with the sandbox isolation and read-only Shadow Mode."]
          : ["Make sure the economic buyer joins the call."],
      confidence: 0.9,
      source_refs: Object.keys(facts).map((k) => `facts.${k}`),
    }),
    (d) => {
      const text = [d.situation, ...d.talking_points, ...d.risks].join(" ");
      const stray = (text.match(/\d[\d,.]*/g) ?? []).filter((n) => !allowed.includes(n.replace(/[.,]$/, "")));
      return stray.length ? `brief contains numbers not computed by code: ${stray.join(", ")}` : null;
    },
  );
}

// Working prototype: read a real invoice. The model only copies values as printed; code checks them afterwards.
export function extractDocument(ctx: Ctx, input: { text?: string; imageB64?: string; pdfB64?: string }, fallback: () => unknown) {
  return runTask(
    "extract_document",
    ExtractedDocSchema,
    ctx,
    {
      system:
        "You read supplier invoices for an accounts-payable team. Copy every value EXACTLY as printed (same digits, commas, decimals, " +
        "percent signs). Never calculate, correct, convert or guess; use \"\" for anything not printed. lines = rows of the item table. " +
        "charges = ONLY extra charges printed as 'Add: <label>' (e.g. freight, handling) — never CGST/SGST/IGST, round-off or totals, which have their own fields. " +
        "sku = the item/product code column of each row (copy it, never leave it empty when printed). placeOfSupplyCode = the 2-digit state code printed with the place of supply. " +
        "currency = USD if the invoice is in US dollars, else INR. Set confidence below 0.5 if any value is hard to read.",
      user: input.text ? `Invoice text layer (table cells separated by tabs):\n${input.text}` : "Read this invoice.",
      imageB64: input.imageB64,
      pdfB64: input.pdfB64,
    },
    fallback,
  );
}
