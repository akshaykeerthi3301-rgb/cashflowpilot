import { query } from "@/db";

const TABLES = ["leads", "outbox", "audit", "review_queue", "directives", "opt_outs"];

// Each visitor gets a private sandbox. Old ones (>24h) are purged lazily — no cron needed.
export async function createWorkspace(): Promise<string> {
  const old = "(SELECT id FROM workspaces WHERE created_at < now() - interval '24 hours')";
  for (const t of TABLES) await query(`DELETE FROM ${t} WHERE workspace_id IN ${old}`);
  await query(`DELETE FROM usage WHERE scope IN ${old}`);
  await query("DELETE FROM workspaces WHERE created_at < now() - interval '24 hours'");
  const id = crypto.randomUUID();
  await query("INSERT INTO workspaces (id) VALUES ($1)", [id]);
  return id;
}

export async function workspaceExists(id: string | undefined): Promise<boolean> {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return false;
  return (await query("SELECT 1 FROM workspaces WHERE id=$1", [id])).length > 0;
}

export async function resetWorkspace(ws: string) {
  for (const t of TABLES) await query(`DELETE FROM ${t} WHERE workspace_id=$1`, [ws]);
  await query("DELETE FROM usage WHERE scope=$1", [ws]);
}
