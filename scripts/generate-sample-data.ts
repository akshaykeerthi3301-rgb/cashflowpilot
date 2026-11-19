// Generates data/invoices.json: two sets (trial, shadow) of invoices + POs + GRNs with planted defects,
// and an answer key built from what was planted (independent of the reconcile engine).
// Fixed seed => identical output every run. Run: npm run gen:data
import { writeFileSync } from "node:fs";
import { lineTax, EXPECTED_GST } from "../src/deterministic/reconcile";
import type { Flag, GRN, Invoice, Line, PO } from "../src/schemas";

const BUYER_STATE = "KA";
export const SUPPLIERS = [
  { id: "S1", name: "Nimbus Components", state: "KA", currency: "INR", items: [["SSD-512", "8471", 345000], ["RAM-16", "8471", 289900], ["PSU-650", "8504", 512000]] },
  { id: "S2", name: "Saffron Spice Traders", state: "KL", currency: "INR", items: [["PEP-BLK-25KG", "0910", 1850000], ["CARD-GRN-10KG", "0910", 2399900]] },
  { id: "S3", name: "Loomcraft Apparel", state: "TN", currency: "INR", items: [["TEE-CTN-M", "6109", 34900], ["TEE-CTN-L", "6109", 36900]] },
  { id: "S4", name: "PolyPack Industries", state: "MH", currency: "INR", items: [["MAILER-A4", "3923", 1250], ["BUBBLE-ROLL", "3923", 89000]] },
  { id: "S5", name: "Ledgerwise Consulting", state: "KA", currency: "INR", items: [["AUDIT-HR", "9983", 450000]] },
  { id: "S6", name: "Harborline Freight", state: "MH", currency: "INR", items: [["FTL-BLR-MUM", "9983", 4200000], ["LTL-PALLET", "9983", 650000]] },
  { id: "S7", name: "Cobalt Cloud Inc", state: "US", currency: "USD", items: [["CLOUD-SEAT", "NA", 4900], ["SUPPORT-PRO", "NA", 120000]] },
  { id: "S8", name: "Meridian Tools LLC", state: "US", currency: "USD", items: [["TORQUE-KIT", "NA", 18999], ["CALIPER-D", "NA", 7450]] },
] as const;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 60;
const DEFECTS: Flag[] = ["QTY_MISMATCH", "PRICE_MISMATCH", "DUPLICATE_INVOICE", "GST_RATE_WRONG", "TAX_MATH_ERROR", "UNAUTHORIZED_CHARGE", "TOTAL_MISMATCH"];
const OLD_SLAB: Record<number, number> = { 18: 28, 5: 12 }; // supplier still billing pre-reform rates

const fmt = (m: number) => (m / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });

function totals(inv: Invoice) {
  const intra = inv.supplierState === inv.buyerState;
  const sub = inv.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  inv.taxTotal = inv.lines.reduce((s, l) => s + lineTax(l.qty * l.unitPrice, l.gstRate, intra).total, 0);
  inv.grandTotal = sub + inv.taxTotal + inv.surcharges.reduce((s, x) => s + x.amount, 0);
  return sub;
}

function rawText(inv: Invoice, smudge: boolean) {
  const sup = SUPPLIERS.find((s) => s.id === inv.supplierId)!;
  const items = inv.lines.map((l, i) => {
    const qty = smudge && i === 0 ? `${String(l.qty)[0]}?` : String(l.qty);
    return `- ${l.sku} | HSN ${l.hsn} | Qty ${qty} | Rate ${fmt(l.unitPrice)} | GST ${l.gstRate}%`;
  });
  return [
    `TAX INVOICE   No: ${inv.number}   Date: ${inv.date}`,
    `Supplier: ${sup.name} (state ${inv.supplierState})   Bill to state: ${inv.buyerState}`,
    `PO Ref: ${inv.poNumber}   Currency: ${inv.currency}`,
    `Items:`,
    ...items,
    ...inv.surcharges.map((s) => `Surcharge: ${s.label} ${fmt(s.amount)}`),
    `Tax total: ${fmt(inv.taxTotal)}`,
    `Grand total: ${fmt(inv.grandTotal)}`,
  ].join("\n");
}

export function generateSet(prefix: "T" | "S", seed: number) {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const invoices: Invoice[] = [], pos: PO[] = [], grns: GRN[] = [], answerKey: Record<string, Flag[]> = {};

  // Plan defects: each type 3x (21) + 3 extra = 24 of 60 (40%). Duplicates need a clean original 8 slots back.
  const plan: (Flag | null)[] = Array(N).fill(null);
  const order = [...Array(N).keys()].sort(() => rnd() - 0.5);
  const want = [...DEFECTS.flatMap((d) => [d, d, d]), "QTY_MISMATCH", "PRICE_MISMATCH", "UNAUTHORIZED_CHARGE"] as Flag[];
  for (const d of want) {
    const slot = order.find((i) => {
      if (plan[i]) return false;
      if (plan[i + SUPPLIERS.length] === "DUPLICATE_INVOICE") return false; // originals of duplicates stay clean
      const sup = SUPPLIERS[i % SUPPLIERS.length];
      if (d === "GST_RATE_WRONG" && sup.currency === "USD") return false;
      if (d === "DUPLICATE_INVOICE") return i >= SUPPLIERS.length && plan[i - SUPPLIERS.length] === null && plan.every((p, j) => !(p === "DUPLICATE_INVOICE" && j === i + SUPPLIERS.length));
      return true;
    });
    if (slot === undefined) throw new Error(`no slot for ${d}`);
    plan[slot] = d;
  }

  for (let i = 0; i < N; i++) {
    const sup = SUPPLIERS[i % SUPPLIERS.length];
    const id = `${prefix}-${String(i + 1).padStart(3, "0")}`;
    const defect = plan[i];

    if (defect === "DUPLICATE_INVOICE") {
      const orig = invoices[i - SUPPLIERS.length];
      invoices.push({ ...structuredClone(orig), id });
      answerKey[id] = ["DUPLICATE_INVOICE"];
      continue;
    }

    const poNumber = `PO-${prefix}${String(i + 1).padStart(3, "0")}`;
    const picks = [...sup.items].sort(() => rnd() - 0.5).slice(0, int(1, sup.items.length));
    const poLines = picks.map(([sku, , price]) => ({ sku, qty: int(2, 60), unitPrice: price }));
    pos.push({ number: poNumber, supplierId: sup.id, lines: poLines });
    const grn: GRN = { poNumber, lines: poLines.map((l) => ({ sku: l.sku, qtyReceived: l.qty })) };
    grns.push(grn);

    const lines: Line[] = picks.map(([sku, hsn], k) => ({ sku, hsn, qty: poLines[k].qty, unitPrice: poLines[k].unitPrice, gstRate: EXPECTED_GST[hsn] }));
    const inv: Invoice = {
      id,
      number: `${sup.id}/26/${String(1000 + i)}`,
      supplierId: sup.id,
      supplierState: sup.state,
      buyerState: BUYER_STATE,
      poNumber,
      date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
      currency: sup.currency,
      lines,
      surcharges: [],
      taxTotal: 0,
      grandTotal: 0,
    };

    switch (defect) {
      case "QTY_MISMATCH": // billed for more than was received
        grn.lines[0].qtyReceived = Math.max(1, lines[0].qty - int(1, Math.max(1, Math.floor(lines[0].qty / 3))));
        if (grn.lines[0].qtyReceived === lines[0].qty) lines[0].qty += 1, poLines[0].qty += 1;
        break;
      case "PRICE_MISMATCH": // 3-8% above PO price
        lines[0].unitPrice = lines[0].unitPrice + Math.ceil((lines[0].unitPrice * int(300, 800)) / 10000);
        break;
      case "GST_RATE_WRONG":
        lines[0].gstRate = OLD_SLAB[lines[0].gstRate];
        break;
    }
    const sub = totals(inv);
    switch (defect) {
      case "TAX_MATH_ERROR": // stated tax is wrong; total is consistent with the wrong tax
        inv.taxTotal += Math.ceil(sub * 0.015) + 100;
        inv.grandTotal = sub + inv.taxTotal;
        break;
      case "UNAUTHORIZED_CHARGE":
        inv.surcharges.push({ label: rnd() < 0.5 ? "Fuel surcharge" : "Handling fee", amount: Math.ceil(sub * 0.02) + 500 });
        inv.grandTotal += inv.surcharges[0].amount;
        break;
      case "TOTAL_MISMATCH":
        inv.grandTotal += int(100, 500) * 100;
        break;
    }
    invoices.push(inv);
    answerKey[id] = defect ? [defect] : [];
  }

  // ~10 invoices arrive as messy text only (AI must extract them); 3 are smudged => must go to human review.
  const textIdx = order.filter((i) => plan[i] !== "DUPLICATE_INVOICE" && !plan.some((p, j) => p === "DUPLICATE_INVOICE" && j - SUPPLIERS.length === i)).slice(0, 10);
  textIdx.forEach((i, k) => {
    const inv = invoices[i];
    inv.raw = rawText(inv, k < 3);
    inv.lines = [];
    inv.surcharges = [];
    inv.taxTotal = 0;
    inv.grandTotal = 0;
  });
  return { invoices, pos, grns, answerKey, smudged: textIdx.slice(0, 3).map((i) => invoices[i].id) };
}

if (process.argv[1]?.endsWith("generate-sample-data.ts")) {
  const out = { suppliers: SUPPLIERS, trial: generateSet("T", 42), shadow: generateSet("S", 4242) };
  writeFileSync("data/invoices.json", JSON.stringify(out, null, 1));
  for (const k of ["trial", "shadow"] as const) {
    const s = out[k];
    const bad = Object.values(s.answerKey).filter((f) => f.length).length;
    console.log(`${k}: ${s.invoices.length} invoices, ${bad} with planted defects, ${s.invoices.filter((i) => i.raw).length} text-only, smudged ${s.smudged.join(",")}`);
  }
}
