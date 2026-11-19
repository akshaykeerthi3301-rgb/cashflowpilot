import type { State } from "@/schemas";

export const MAIN: State[] = ["DISCOVERED", "OUTREACH_ACTIVE", "SANDBOX_TRIAL", "CALL_BOOKED", "PRE_SALE_HOLD", "PROVISIONING", "STAGE_A_SHADOW_MODE", "STAGE_B_PRODUCTION_ACTIVE"];
const LABEL: Record<State, string> = {
  DISCOVERED: "Discovered", OUTREACH_ACTIVE: "Outreach", SANDBOX_TRIAL: "Sandbox trial", CALL_BOOKED: "Call booked",
  PRE_SALE_HOLD: "Locked: awaiting founder", PROVISIONING: "Provisioning", STAGE_A_SHADOW_MODE: "Shadow mode (read-only)",
  STAGE_B_PRODUCTION_ACTIVE: "Stage B (assisted)", OPTED_OUT: "Opted out", CLOSED_LOST: "Closed lost",
};

export function StateBadge({ state }: { state: State }) {
  const tone = state === "PRE_SALE_HOLD" ? "warn" : state === "OPTED_OUT" || state === "CLOSED_LOST" ? "bad" : MAIN.indexOf(state) >= 5 ? "ok" : "info";
  return <span className={`badge ${tone}`}>{LABEL[state]}</span>;
}

export function Pipeline({ state }: { state: State }) {
  const at = MAIN.indexOf(state);
  return (
    <div className="pipeline" aria-label="Deal stage">
      {MAIN.map((s, i) => (
        <span key={s} className={`${i < at ? "done" : i === at ? "now" : ""} ${s === "PRE_SALE_HOLD" ? "lock" : ""}`}>{LABEL[s]}</span>
      ))}
      {at < 0 && <StateBadge state={state} />}
    </div>
  );
}
