import { resetWorkspace } from "@/workspace";
import { apiWs, json } from "../../server";

export async function POST() {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  await resetWorkspace(ws);
  return json({ ok: true });
}
