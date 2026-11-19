import Link from "next/link";
import { TopBar } from "./TopBar";

export function NoRun() {
  return (
    <>
      <TopBar />
      <div className="page" style={{ textAlign: "center", paddingTop: 96 }}>
        <div className="eyebrow">Nothing here yet</div>
        <h1 style={{ margin: "10px 0 12px" }}>Run the agent first</h1>
        <p className="muted">Each visitor gets a private demo. Start a run and the details will appear here.</p>
        <Link href="/run" className="btn gold" style={{ marginTop: 18 }}>Run the agent →</Link>
      </div>
    </>
  );
}
