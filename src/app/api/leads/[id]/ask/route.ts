import { answerQuestion } from "@/providers/llm";
import { toReview } from "@/agents/common";
import { apiWs, json } from "../../../../server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const { id } = await params;
  const q = String((await req.json().catch(() => ({})))?.question ?? "").trim().slice(0, 300);
  if (q.length < 3) return json({ error: "Type a question first" }, 400);
  const r = await answerQuestion({ ws, leadId: id }, q);
  if (!r.ok) await toReview(ws, id, `Visitor question not covered: ${r.reason}`, { q });
  return json(r.ok ? { answer: r.data.answer, source: `faq.${r.data.faq_id}`, by: r.source } : { answer: "Not covered by approved docs — routed to the founder.", source: "review", by: r.source });
}
