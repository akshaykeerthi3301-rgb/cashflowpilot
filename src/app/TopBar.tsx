import Link from "next/link";

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="mark"><i />CashFlowPilot</Link>
      <div className="meta">{children ?? <span>Portfolio project · simulated companies</span>}</div>
    </header>
  );
}
