import { getLead } from "@/agents/common";
import { ics } from "@/providers/calendar";
import { apiWs } from "../../../../server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await apiWs();
  if (typeof ws !== "string") return ws;
  const lead = await getLead(ws, (await params).id);
  if (!lead?.call_at) return new Response("No call booked", { status: 404 });
  const body = ics({
    uid: `${ws}-${lead.id}`,
    startIso: lead.call_at,
    title: `CashFlowPilot x ${lead.name}`,
    attendee: lead.contact_email,
    description: `Closure call with ${lead.contact_name}. Pre-call brief: /leads/${lead.id}/brief`,
  });
  return new Response(body, { headers: { "content-type": "text/calendar", "content-disposition": `attachment; filename="${lead.id}-call.ics"` } });
}
