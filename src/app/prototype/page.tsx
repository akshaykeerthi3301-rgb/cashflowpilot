import { manifest } from "@/documents/erp";
import Prototype from "./Prototype";
import "../run/run.css";
import "./prototype.css";

export const dynamic = "force-dynamic";

export default function PrototypePage() {
  const m = manifest();
  return (
    <Prototype
      batches={[
        { id: "kaveri", title: "Kaveri Naturals", region: "India · GST", buyer: m.kaveri.buyer, docs: m.kaveri.docs, note: "6 suppliers, 3 invoice layouts, 5 photocopied scans" },
        { id: "northbeam", title: "Northbeam Analytics", region: "United States · USD", buyer: m.northbeam.buyer, docs: m.northbeam.docs, note: "2 suppliers, US invoice layout, 2 scans" },
      ]}
    />
  );
}
