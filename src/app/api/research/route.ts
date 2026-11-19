import { research } from "@/agents/researcher";
import { apiWs, json } from "../../server";

export async function POST() {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  return json({ added: await research(ws) });
}
