import { transition } from "@/state_machine";
import { getLead } from "./common";
import { handleReply, sendOutreach } from "./outreach_sandbox";
import { runTrial } from "./trial_pitcher";
import { prepAndBook } from "./deal_prep_booker";

// One short step per call (fits serverless time limits). The UI loops this for "Run full demo".
export async function advance(ws: string, leadId: string): Promise<{ did: string; state: string }> {
  const lead = await getLead(ws, leadId);
  if (!lead) return { did: "lead not found", state: "?" };
  let did: string;
  switch (lead.state) {
    case "DISCOVERED":
      did = await sendOutreach(ws, lead);
      break;
    case "OUTREACH_ACTIVE":
      did = await handleReply(ws, lead);
      break;
    case "SANDBOX_TRIAL":
      did = lead.trial ? await prepAndBook(ws, lead) : await runTrial(ws, lead);
      break;
    case "CALL_BOOKED": {
      const t = await transition(ws, lead.id, "PRE_SALE_HOLD", "agent");
      did = t.ok ? "deal locked" : t.reason;
      break;
    }
    case "PRE_SALE_HOLD":
      did = "LOCKED — only the founder can release this deal";
      break;
    default:
      did = "nothing for the agent to do";
  }
  return { did, state: (await getLead(ws, leadId))!.state };
}
