import { advance } from "@/agents/advance";
import { apiWs, json } from "../../../../server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  return json(await advance(ws, (await params).id));
}
