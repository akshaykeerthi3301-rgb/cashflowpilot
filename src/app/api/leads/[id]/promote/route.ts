import { promoteStageB } from "@/agents/provisioner_shadow";
import { apiWs, json } from "../../../../server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  return json(await promoteStageB(ws, (await params).id));
}
