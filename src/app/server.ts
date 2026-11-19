import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createWorkspace, workspaceExists } from "@/workspace";
import { bumpUsage } from "@/deterministic/limits";

export const COOKIE = "cfp_ws";
const API_CALLS_PER_DAY = 1500;

// Pages only read: no valid workspace => null (the page shows "run the agent first").
export async function pageWs(): Promise<string | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  return (await workspaceExists(id)) ? id! : null;
}

// API routes: the workspace comes from the cookie only (never the request body). A visitor without one gets a
// fresh private workspace on their first call — no redirects. Plus a per-visitor daily rate limit.
export async function apiWs(): Promise<string | NextResponse> {
  const jar = await cookies();
  let id = jar.get(COOKIE)?.value;
  if (!(await workspaceExists(id))) {
    id = await createWorkspace();
    jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86400, path: "/" });
  }
  if (!(await bumpUsage(id!, "api", API_CALLS_PER_DAY))) return NextResponse.json({ error: "daily demo limit reached" }, { status: 429 });
  return id!;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
