import path from "node:path";
import { SCHEMA } from "./db/schema";

// One query() for the whole app. Neon when DATABASE_URL is set (Vercel), PGlite otherwise
// (in-memory under tests, ./.pglite on disk in local dev). Same SQL in both.
type Runner = (sql: string, params: unknown[]) => Promise<unknown[]>;

const TABLES = ["workspaces", "leads", "outbox", "audit", "review_queue", "directives", "opt_outs", "usage", "doc_cache"];

const g = globalThis as unknown as { __cfpDb?: Promise<{ run: Runner; exec: (s: string) => Promise<void> }> };

async function connect() {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    const run: Runner = (q, p) => sql.query(q, p) as Promise<unknown[]>;
    const exec = async (s: string) => {
      for (const stmt of s.split(";").map((x) => x.trim()).filter(Boolean)) await sql.query(stmt);
    };
    await exec(SCHEMA);
    return { run, exec };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = process.env.VITEST ? new PGlite() : new PGlite(path.join(process.cwd(), ".pglite"));
  await db.exec(SCHEMA);
  return {
    run: async (q: string, p: unknown[]) => (await db.query(q, p as never[])).rows,
    exec: async (s: string) => void (await db.exec(s)),
  };
}

function conn() {
  return (g.__cfpDb ??= connect());
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await (await conn()).run(sql, params)) as T[];
}

export async function resetDbForTests() {
  await (await conn()).exec(TABLES.map((t) => `DELETE FROM ${t}`).join(";"));
}
