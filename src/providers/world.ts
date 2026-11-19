// The simulated buyers. Deterministic so every demo run tells the same story.
export type Reply = { kind: "accept_trial" | "question" | "opt_out"; text: string } | null;

export function buyerReply(persona: string, inboundSoFar: number): Reply {
  if (persona === "silent") return null;
  if (persona === "opt_out") return { kind: "opt_out", text: "Not interested. Please unsubscribe me." };
  if (persona === "skeptical" && inboundSoFar === 0)
    return {
      kind: "question",
      text: "Before I look at anything: how secure is this? We will not give a vendor access to our Tally or bank data.",
    };
  if (persona === "lukewarm") return { kind: "accept_trial", text: "Sure, send the link. I'll look when I get time." };
  return { kind: "accept_trial", text: "Timing is good — we're drowning in vendor invoices. Send the sandbox." };
}

// What the buyer does inside the sandbox; intent is scored from these events by code.
export function trialActivity(persona: string): { events: string[]; question: string | null } {
  switch (persona) {
    case "eager":
      return {
        events: ["trial_opened", "file_uploaded", "roi_viewed", "question_asked", "return_visit"],
        question: "Does it handle IGST on inter-state invoices and CGST/SGST within the state?",
      };
    case "skeptical":
      return {
        events: ["trial_opened", "file_uploaded", "roi_viewed", "question_asked", "question_asked", "return_visit"],
        question: "What happens to our data after the trial — how long do you keep it and can we delete it?",
      };
    default:
      return { events: ["trial_opened", "roi_viewed"], question: null };
  }
}
