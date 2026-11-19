// Generates the WORKING PROTOTYPE's documents: real PDF invoices (4 layouts, some scanned) + ERP CSV exports,
// and a separate ground-truth file used ONLY by tests and the accuracy eval (never by the reading pipeline).
// Run: npm run gen:prototype   (fixed seed => identical files every run; needs macOS/Linux system fonts for scans)
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { EXPECTED_GST, lineTax } from "../src/deterministic/reconcile";
import { STATE_CODES, amountInWords, gstinCheckChar, printAmount } from "../src/deterministic/gst";
import type { Flag, GRN, Invoice, PO } from "../src/schemas";

const OUT = "data/prototype";
const STATE_NAME: Record<string, string> = { KA: "Karnataka", KL: "Kerala", TN: "Tamil Nadu", MH: "Maharashtra" };
type Item = { sku: string; desc: string; hsn: string; price: number; qty: [number, number] };
type Vendor = { id: string; name: string; state: string; currency: "INR" | "USD"; layout: 1 | 2 | 3 | 4; address: string; pan: string; items: Item[] };

const gstin = (state: string, pan: string) => { const f = `${STATE_CODES[state]}${pan}1Z`; return f + gstinCheckChar(f); };

const VENDORS: Vendor[] = [
  { id: "S1", name: "Nimbus Components Pvt Ltd", state: "KA", currency: "INR", layout: 1, address: "14 Hosur Road, Bengaluru 560068", pan: "AADCN4417K", items: [
    { sku: "SSD-512", desc: "NVMe SSD 512 GB", hsn: "8471", price: 345000, qty: [4, 40] },
    { sku: "RAM-16", desc: "DDR5 RAM 16 GB", hsn: "8471", price: 289900, qty: [4, 40] },
    { sku: "PSU-650", desc: "Power Supply 650 W", hsn: "8504", price: 512000, qty: [2, 20] } ] },
  { id: "S2", name: "Saffron Spice Traders", state: "KL", currency: "INR", layout: 1, address: "Bazaar Road, Mattancherry, Kochi 682002", pan: "ABKFS2290Q", items: [
    { sku: "PEP-BLK-25", desc: "Black Pepper, 25 kg bag", hsn: "0910", price: 1850000, qty: [2, 16] },
    { sku: "CARD-GRN-10", desc: "Green Cardamom, 10 kg", hsn: "0910", price: 2399900, qty: [1, 10] } ] },
  { id: "S3", name: "Loomcraft Apparel", state: "TN", currency: "INR", layout: 2, address: "SIDCO Estate, Tiruppur 641604", pan: "AAJFL7731C", items: [
    { sku: "TEE-CTN-M", desc: "Cotton T-shirt, size M", hsn: "6109", price: 34900, qty: [50, 400] },
    { sku: "TEE-CTN-L", desc: "Cotton T-shirt, size L", hsn: "6109", price: 36900, qty: [50, 400] } ] },
  { id: "S4", name: "PolyPack Industries", state: "MH", currency: "INR", layout: 2, address: "Plot 22, MIDC Bhosari, Pune 411026", pan: "AAGCP5108M", items: [
    { sku: "MAILER-A4", desc: "Poly mailer bag, A4", hsn: "3923", price: 1250, qty: [500, 5000] },
    { sku: "BUBBLE-100", desc: "Bubble wrap roll, 100 m", hsn: "3923", price: 89000, qty: [5, 40] } ] },
  { id: "S5", name: "Ledgerwise Consulting LLP", state: "KA", currency: "INR", layout: 3, address: "100 Ft Road, Indiranagar, Bengaluru 560038", pan: "AAHFL3302B", items: [
    { sku: "AUD-HR", desc: "Audit support services (per hour)", hsn: "9983", price: 450000, qty: [4, 40] } ] },
  { id: "S6", name: "Harborline Freight", state: "MH", currency: "INR", layout: 3, address: "JNPT Road, Navi Mumbai 400707", pan: "AABCH6624H", items: [
    { sku: "FTL-BLR-MUM", desc: "Full truck load, Bengaluru to Mumbai", hsn: "9983", price: 4200000, qty: [1, 6] },
    { sku: "LTL-PALLET", desc: "Part load, per pallet", hsn: "9983", price: 650000, qty: [2, 20] } ] },
  { id: "S7", name: "Cobalt Cloud Inc", state: "US", currency: "USD", layout: 4, address: "500 Howard St, San Francisco, CA 94105", pan: "", items: [
    { sku: "CLOUD-SEAT", desc: "Cloud workspace seat (monthly)", hsn: "NA", price: 4900, qty: [20, 300] },
    { sku: "SUPPORT-PRO", desc: "Pro support plan (monthly)", hsn: "NA", price: 120000, qty: [1, 3] } ] },
  { id: "S8", name: "Meridian Tools LLC", state: "US", currency: "USD", layout: 4, address: "2100 S Congress Ave, Austin, TX 78704", pan: "", items: [
    { sku: "TORQUE-KIT", desc: "Torque wrench kit", hsn: "NA", price: 18999, qty: [2, 40] },
    { sku: "CALIPER-D", desc: "Digital caliper, 150 mm", hsn: "NA", price: 7450, qty: [5, 80] } ] },
];
const BUYERS = {
  kaveri: { name: "Kaveri Naturals Pvt Ltd", address: "80 Feet Road, Koramangala, Bengaluru 560034", state: "KA", gstin: gstin("KA", "AAKCK4821N") },
  northbeam: { name: "Northbeam Analytics Inc", address: "600 Congress Ave, Austin, TX 78701", state: "US", gstin: "" },
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- drawing (same layouts drawn as vector PDF or as a scanned image) ----------------
type Opt = { size?: number; bold?: boolean; align?: "left" | "right" | "center" };
interface Painter { text(s: string, x: number, y: number, o?: Opt): void; line(x1: number, y1: number, x2: number, y2: number): void; rect(x: number, y: number, w: number, h: number): void; }
const H = 842;

function pdfPainter(page: PDFPage, font: PDFFont, bold: PDFFont): Painter {
  const ink = rgb(0.12, 0.12, 0.14), rule = rgb(0.45, 0.45, 0.48);
  return {
    text(s, x, y, { size = 9, bold: b = false, align = "left" } = {}) {
      const f = b ? bold : font, w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: align === "right" ? x - w : align === "center" ? x - w / 2 : x, y: H - y, size, font: f, color: ink });
    },
    line(x1, y1, x2, y2) { page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 0.6, color: rule }); },
    rect(x, y, w, h) { page.drawRectangle({ x, y: H - y - h, width: w, height: h, borderWidth: 0.6, borderColor: rule }); },
  };
}
const S = 2; // scan resolution: 2 px per point (~144 dpi)
function canvasPainter(ctx: SKRSContext2D): Painter {
  return {
    text(s, x, y, { size = 9, bold = false, align = "left" } = {}) {
      ctx.font = `${bold ? "bold " : ""}${size * S}px Helvetica`;
      const w = ctx.measureText(s).width;
      ctx.fillStyle = "#1f1f24";
      ctx.fillText(s, (align === "right" ? x * S - w : align === "center" ? x * S - w / 2 : x * S), y * S);
    },
    line(x1, y1, x2, y2) { ctx.strokeStyle = "#6e6e75"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1 * S, y1 * S); ctx.lineTo(x2 * S, y2 * S); ctx.stroke(); },
    rect(x, y, w, h) { ctx.strokeStyle = "#6e6e75"; ctx.lineWidth = 1.2; ctx.strokeRect(x * S, y * S, w * S, h * S); },
  };
}

type Doc = Invoice & { cgst: number; sgst: number; igst: number };
type Buyer = (typeof BUYERS)[keyof typeof BUYERS];

function draw(p: Painter, d: Doc, v: Vendor, b: Buyer) {
  const money = (m: number) => printAmount(m, d.currency);
  const pos = b.gstin ? `${STATE_NAME[b.state]} (${STATE_CODES[b.state]})` : "";
  const L = v.layout;
  // header + party blocks
  if (L === 1) {
    p.text(v.name, 40, 50, { size: 16, bold: true }); p.text("TAX INVOICE", 555, 50, { size: 14, bold: true, align: "right" });
    p.text(v.address, 40, 68); p.text(`GSTIN: ${d.supplierGstin}`, 40, 82);
    p.rect(40, 108, 515, 80);
    p.text(`Bill To: ${b.name}`, 50, 126); p.text(`Invoice No: ${d.number}`, 340, 126);
    p.text(b.address, 50, 140); p.text(`Invoice Date: ${d.date}`, 340, 140);
    p.text(`Buyer GSTIN: ${b.gstin}`, 50, 154); p.text(`PO Ref: ${d.poNumber}`, 340, 154);
    p.text(`Place of Supply: ${pos}`, 50, 168);
  } else if (L === 2) {
    p.text(v.name, 40, 55, { size: 18, bold: true }); p.text(`Invoice #: ${d.number}`, 555, 55, { size: 10, bold: true, align: "right" });
    p.text(`Seller GSTIN: ${d.supplierGstin}`, 40, 75); p.text(`Dated: ${d.date}`, 555, 75, { align: "right" });
    p.text(v.address, 40, 89); p.text(`Purchase Order: ${d.poNumber}`, 555, 89, { align: "right" });
    p.line(40, 104, 555, 104);
    p.text("Billed to", 40, 122, { size: 8 }); p.text(b.name, 40, 136, { bold: true });
    p.text(`Customer GSTIN: ${b.gstin}`, 40, 150); p.text(`Supply To: ${pos}`, 40, 164);
  } else if (L === 3) {
    p.text(v.name, 40, 45, { size: 13, bold: true }); p.text(`Bill No.: ${d.number}`, 555, 45, { align: "right" });
    p.text(v.address, 40, 60); p.text(`Bill Date: ${d.date}`, 555, 60, { align: "right" });
    p.text(`Our GSTIN: ${d.supplierGstin}`, 40, 75); p.text(`Against PO: ${d.poNumber}`, 555, 75, { align: "right" });
    p.line(40, 84, 555, 84);
    p.text(`Billed To: ${b.name}`, 40, 98); p.text(`POS: ${STATE_CODES[b.state]}-${STATE_NAME[b.state]}`, 555, 98, { align: "right" });
    p.text(`Your GSTIN: ${b.gstin}`, 40, 112); p.text("TAX INVOICE (SERVICES)", 555, 112, { size: 8, align: "right" });
  } else {
    p.text(v.name, 40, 50, { size: 14, bold: true }); p.text("INVOICE", 555, 50, { size: 20, bold: true, align: "right" });
    p.text(v.address, 40, 66);
    p.text(`Bill To: ${b.name}`, 40, 100); p.text(`Invoice Number: ${d.number}`, 555, 100, { align: "right" });
    p.text(b.address, 40, 114); p.text(`Invoice Date: ${d.date}`, 555, 114, { align: "right" });
    p.text(`Customer PO: ${d.poNumber}`, 555, 128, { align: "right" });
  }
  // line-item table
  const cols: [string, number, "left" | "right"][] =
    L === 1 ? [["#", 45, "left"], ["Item Code", 62, "left"], ["Description", 132, "left"], ["HSN", 300, "left"], ["Qty", 368, "right"], ["Rate", 438, "right"], ["GST %", 482, "right"], ["Amount", 550, "right"]]
    : L === 2 ? [["SKU", 40, "left"], ["Item", 118, "left"], ["HSN/SAC", 292, "left"], ["Qty", 362, "right"], ["Unit Price", 440, "right"], ["Tax %", 488, "right"], ["Line Total", 555, "right"]]
    : L === 3 ? [["Code", 40, "left"], ["Particulars", 112, "left"], ["SAC", 302, "left"], ["Qty", 360, "right"], ["Rate", 430, "right"], ["GST", 470, "right"], ["Value", 555, "right"]]
    : [["Item No.", 40, "left"], ["Description", 130, "left"], ["Qty", 380, "right"], ["Unit Price", 460, "right"], ["Amount", 555, "right"]];
  let y = L === 3 ? 140 : L === 4 ? 162 : 212;
  p.line(40, y - 13, 555, y - 13);
  for (const [h, x, a] of cols) p.text(h, x, y, { bold: true, align: a });
  p.line(40, y + 6, 555, y + 6);
  y += 22;
  d.lines.forEach((l, i) => {
    const cells: Record<string, string> = {
      "#": String(i + 1), "Item Code": l.sku, SKU: l.sku, Code: l.sku, "Item No.": l.sku,
      Description: l.description!, Item: l.description!, Particulars: l.description!,
      HSN: l.hsn, "HSN/SAC": l.hsn, SAC: l.hsn, Qty: String(l.qty), Rate: money(l.unitPrice), "Unit Price": money(l.unitPrice),
      "GST %": `${l.gstRate}%`, "Tax %": `${l.gstRate}%`, GST: `${l.gstRate}%`,
      Amount: money(l.qty * l.unitPrice), "Line Total": money(l.qty * l.unitPrice), Value: money(l.qty * l.unitPrice),
    };
    for (const [h, x, a] of cols) p.text(cells[h], x, y, { align: a });
    y += 16;
  });
  p.line(40, y - 6, 555, y - 6);
  // totals
  y += 12;
  const lab: Record<string, string> = L === 1 ? { sub: "Taxable Value", ro: "Round Off", grand: "Grand Total" }
    : L === 2 ? { sub: "Sub Total", ro: "Rounding", grand: "Total Payable" }
    : L === 3 ? { sub: "Total Taxable", ro: "R/O", grand: "Net Amount" } : { sub: "Subtotal", ro: "", grand: "Total Due (USD)" };
  const row = (label: string, value: number, bold = false) => { p.text(label, 360, y, { bold }); p.text(money(value), 555, y, { bold, align: "right" }); y += 15; };
  row(lab.sub, d.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  if (d.taxType === "CGST_SGST") { row("CGST", d.cgst); row("SGST", d.sgst); }
  if (d.taxType === "IGST") row("IGST", d.igst);
  for (const s of d.surcharges) row(`Add: ${s.label}`, s.amount);
  if (d.currency === "INR") row(lab.ro, d.roundOff ?? 0);
  p.line(360, y - 9, 555, y - 9);
  y += 2; row(lab.grand, d.grandTotal, true);
  y += 10;
  const wordsLabel = L === 1 ? "Amount in Words" : L === 2 ? "In words" : L === 3 ? "Amount Chargeable (in words)" : "Amount in words";
  p.text(`${wordsLabel}: ${d.amountInWords}`, 40, y, { size: 8.5 });
  y += 30;
  p.text(d.currency === "INR" ? "Bank: HDFC Bank  A/c 50200012345678  IFSC HDFC0001234" : "Wire: First Republic  ABA 321081669  Acct 80001234567", 40, y, { size: 8 });
  p.text(`For ${v.name}`, 555, y, { size: 8, align: "right" });
  p.text("Authorised Signatory", 555, y + 34, { size: 8, align: "right" });
  p.text("This is a computer generated invoice.", 297, 815, { size: 7, align: "center" });
}

async function renderPdf(d: Doc, v: Vendor, b: Buyer, scan: boolean, rnd: () => number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fixed = new Date("2026-10-01T00:00:00Z");
  pdf.setTitle(`Invoice ${d.number}`); pdf.setProducer("CashFlowPilot sample generator"); pdf.setCreator(v.name);
  pdf.setCreationDate(fixed); pdf.setModificationDate(fixed);
  const page = pdf.addPage([595, H]);
  if (!scan) {
    draw(pdfPainter(page, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)), d, v, b);
  } else {
    // Draw the same invoice as an image, then make it look photocopied: slight tilt, grey paper, speckles.
    const flat = createCanvas(595 * S, H * S), fc = flat.getContext("2d");
    fc.fillStyle = "#ffffff"; fc.fillRect(0, 0, 595 * S, H * S);
    draw(canvasPainter(fc), d, v, b);
    const out = createCanvas(595 * S, H * S), oc = out.getContext("2d");
    oc.fillStyle = "#efece4"; oc.fillRect(0, 0, 595 * S, H * S);
    oc.translate((595 * S) / 2, (H * S) / 2); oc.rotate((rnd() - 0.5) * 0.03); oc.translate((-595 * S) / 2, (-H * S) / 2);
    oc.globalAlpha = 0.93; oc.drawImage(flat, 0, 0); oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalAlpha = 1;
    for (let i = 0; i < 2500; i++) { oc.fillStyle = `rgba(60,60,60,${0.15 + rnd() * 0.3})`; oc.fillRect(rnd() * 595 * S, rnd() * H * S, 1 + rnd() * 2, 1 + rnd() * 2); }
    const jpg = await pdf.embedJpg(out.toBuffer("image/jpeg", 72));
    page.drawImage(jpg, { x: 0, y: 0, width: 595, height: H });
  }
  return pdf.save({ useObjectStreams: false });
}

// ---------------- data + planted defects ----------------
type Defect = Flag;
function makeBatch(key: keyof typeof BUYERS, vendorIds: string[], n: number, defects: Defect[], scans: number, seed: number) {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const buyer = BUYERS[key];
  const vs = vendorIds.map((id) => VENDORS.find((v) => v.id === id)!);
  const k = vs.length;
  const plan: (Defect | null)[] = Array(n).fill(null);
  const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
  for (const d of defects) {
    const slot = order.find((i) => {
      if (plan[i] || plan[i + k] === "DUPLICATE_INVOICE") return false;
      if (d === "DUPLICATE_INVOICE") return i >= k && plan[i - k] === null;
      return true;
    });
    if (slot === undefined) throw new Error(`no slot for ${d}`);
    plan[slot] = d;
  }
  const scanIds = new Set(order.filter((i) => plan[i] !== "DUPLICATE_INVOICE" && plan[i + k] !== "DUPLICATE_INVOICE").slice(0, scans));
  const docs: Doc[] = [], pos: PO[] = [], grns: GRN[] = [], answerKey: Record<string, Flag[]> = {};
  const prefix = key === "kaveri" ? "KN" : "NB";

  for (let i = 0; i < n; i++) {
    const v = vs[i % k];
    const id = `${prefix}-${String(i + 1).padStart(3, "0")}`;
    const defect = plan[i];
    if (defect === "DUPLICATE_INVOICE") {
      docs.push({ ...structuredClone(docs[i - k]), id });
      answerKey[id] = ["DUPLICATE_INVOICE"];
      continue;
    }
    const poNumber = `PO/${prefix}/${2400 + i}`;
    const picks = [...v.items].sort(() => rnd() - 0.5).slice(0, int(1, v.items.length));
    const poLines = picks.map((it) => ({ sku: it.sku, qty: int(it.qty[0], it.qty[1]), unitPrice: it.price }));
    pos.push({ number: poNumber, supplierId: v.id, lines: poLines });
    const grn: GRN = { poNumber, lines: poLines.map((l) => ({ sku: l.sku, qtyReceived: l.qty })) };
    grns.push(grn);
    const inr = v.currency === "INR";
    const intra = v.state === buyer.state;
    const lines = picks.map((it, j) => ({ sku: it.sku, hsn: it.hsn, description: it.desc, qty: poLines[j].qty, unitPrice: it.price, gstRate: inr ? EXPECTED_GST[it.hsn] : 0 }));
    if (defect === "QTY_MISMATCH") grn.lines[0].qtyReceived = Math.max(1, lines[0].qty - int(1, Math.max(1, Math.floor(lines[0].qty / 4))));
    if (defect === "QTY_MISMATCH" && grn.lines[0].qtyReceived === lines[0].qty) { lines[0].qty += 1; poLines[0].qty += 1; }
    if (defect === "PRICE_MISMATCH") lines[0].unitPrice += Math.ceil((lines[0].unitPrice * int(300, 800)) / 10000);
    if (defect === "GST_RATE_WRONG") lines[0].gstRate = ({ 18: 28, 5: 12 } as Record<number, number>)[lines[0].gstRate];
    let taxType: Doc["taxType"] = !inr ? "NONE" : intra ? "CGST_SGST" : "IGST";
    if (defect === "WRONG_TAX_TYPE") taxType = taxType === "CGST_SGST" ? "IGST" : "CGST_SGST";
    let cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      const t = lineTax(l.qty * l.unitPrice, l.gstRate, taxType === "CGST_SGST");
      cgst += t.cgst; sgst += t.sgst; igst += t.igst;
    }
    const sub = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    if (defect === "TAX_MATH_ERROR") { if (taxType === "IGST") igst += Math.ceil(sub * 0.012) + 37; else cgst += Math.ceil(sub * 0.006) + 37; }
    const surcharges = defect === "UNAUTHORIZED_CHARGE" ? [{ label: rnd() < 0.5 ? "Fuel surcharge" : "Handling charges", amount: Math.ceil(sub * 0.02) + 500 }] : [];
    const taxTotal = cgst + sgst + igst;
    const raw = sub + taxTotal + surcharges.reduce((s, x) => s + x.amount, 0);
    let grandTotal = inr ? Math.floor((raw + 50) / 100) * 100 : raw;
    const roundOff = inr ? grandTotal - raw : 0;
    if (defect === "TOTAL_MISMATCH") grandTotal += int(2, 90) * 100;
    const words = amountInWords(defect === "WORDS_MISMATCH" ? grandTotal + int(10, 900) * 100 : grandTotal, v.currency);
    const supplierGstin = inr ? gstin(v.state, v.pan) : "";
    const day = new Date(Date.UTC(2026, 8, 1 + i));
    docs.push({
      id, number: `${v.id}/26-27/${String(1000 + i)}`, supplierId: v.id, supplierName: v.name, supplierState: v.state, buyerState: buyer.state,
      buyerName: buyer.name, buyerGstin: buyer.gstin, poNumber,
      date: inr ? `${String(day.getUTCDate()).padStart(2, "0")}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${day.getUTCFullYear()}` : day.toISOString().slice(0, 10),
      currency: v.currency, lines, surcharges, taxType, cgst, sgst, igst, taxTotal, roundOff: inr ? roundOff : undefined, grandTotal,
      amountInWords: words,
      supplierGstin: defect === "INVALID_GSTIN" ? supplierGstin.slice(0, 14) + (supplierGstin[14] === "A" ? "B" : "A") : supplierGstin,
    });
    answerKey[id] = defect ? [defect] : [];
  }
  return { buyer, vs, docs, pos, grns, answerKey, scanIds: [...scanIds].map((i) => docs[i].id), rnd };
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.join(",")).join("\n") + "\n";
const dec = (m: number) => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, "0")}`;

async function main() {
  const ALL7: Defect[] = ["QTY_MISMATCH", "PRICE_MISMATCH", "DUPLICATE_INVOICE", "TAX_MATH_ERROR", "UNAUTHORIZED_CHARGE", "TOTAL_MISMATCH", "WORDS_MISMATCH"];
  const INDIA: Defect[] = [...ALL7, "GST_RATE_WRONG", "INVALID_GSTIN", "WRONG_TAX_TYPE"];
  const batches = {
    kaveri: makeBatch("kaveri", ["S1", "S2", "S3", "S4", "S5", "S6"], 48, [...INDIA, ...INDIA], 5, 7),
    northbeam: makeBatch("northbeam", ["S7", "S8"], 16, ALL7.filter((d) => d !== "TAX_MATH_ERROR"), 2, 11),
  };
  mkdirSync(`${OUT}/erp`, { recursive: true });
  writeFileSync(`${OUT}/erp/vendors.csv`, csv([["vendor_id", "name", "gstin", "state", "currency"], ...VENDORS.map((v) => [v.id, v.name, v.currency === "INR" ? gstin(v.state, v.pan) : "", v.state, v.currency])]));
  const manifest: Record<string, unknown> = {};
  const truth: Record<string, unknown> = {};
  for (const [key, b] of Object.entries(batches)) {
    mkdirSync(`${OUT}/pdfs/${key}`, { recursive: true });
    writeFileSync(`${OUT}/erp/${key}-purchase-orders.csv`, csv([["po_number", "vendor_id", "item_code", "qty", "rate"], ...b.pos.flatMap((p) => p.lines.map((l) => [p.number, p.supplierId, l.sku, l.qty, dec(l.unitPrice)]))]));
    writeFileSync(`${OUT}/erp/${key}-goods-receipts.csv`, csv([["grn_number", "po_number", "item_code", "received_qty"], ...b.grns.flatMap((g, i) => g.lines.map((l) => [`GRN-${key.slice(0, 2).toUpperCase()}-${5000 + i}`, g.poNumber, l.sku, l.qtyReceived]))]));
    for (const d of b.docs) {
      const v = VENDORS.find((x) => x.id === d.supplierId)!;
      writeFileSync(`${OUT}/pdfs/${key}/${d.id}.pdf`, await renderPdf(d, v, b.buyer, b.scanIds.includes(d.id), b.rnd));
    }
    manifest[key] = { buyer: b.buyer.name, currency: b.vs[0].currency, docs: b.docs.map((d) => d.id) };
    truth[key] = { invoices: b.docs.map(({ cgst, sgst, igst, ...inv }) => ({ ...inv, cgst, sgst, igst })), answerKey: b.answerKey, scans: b.scanIds };
    const bad = Object.values(b.answerKey).filter((f) => f.length).length;
    console.log(`${key}: ${b.docs.length} PDFs (${b.scanIds.length} scans), ${bad} with planted problems`);
  }
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
  writeFileSync(`${OUT}/truth.json`, JSON.stringify(truth, null, 1));
}
main();
