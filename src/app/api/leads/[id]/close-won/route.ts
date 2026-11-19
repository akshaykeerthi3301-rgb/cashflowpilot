import { founderCloseWon } from "@/agents/provisioner_shadow";
import { getLead } from "@/agents/common";
import { apiWs, json } from "../../../../server";

// The founder's button. In this public demo the visitor plays the founder; a real deployment puts auth here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const body = await req.json().catch(() => null);
  const { id } = await params;
  const r = await founderCloseWon(ws, id, body);
  if (!r.ok) return json(r, 400);
  const lead = await getLead(ws, id);
  return json({ ok: true, state: lead?.state, shadow: lead?.shadow });
}
