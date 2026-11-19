import { runStage, STAGES, type Stage } from "@/agents/run";
import { apiWs, json } from "../../../server";

export async function POST(req: Request) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const stage = (await req.json().catch(() => ({})))?.stage;
  if (!STAGES.includes(stage)) return json({ error: "unknown stage" }, 400);
  return json(await runStage(ws, stage as Stage));
}
