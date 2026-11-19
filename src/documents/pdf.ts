// Low-level PDF access, all deterministic: the text layer as lines, the embedded scan image, page count.
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { getDocumentProxy } from "unpdf";

export const MAX_PAGES = 3;

// Text items grouped into visual lines (top to bottom), cells joined with a tab.
export async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const lines: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
    const items = (await (await pdf.getPage(n)).getTextContent()).items as { str: string; transform: number[] }[];
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2; // 2pt tolerance
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str.trim() }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((c) => c.s).join("\t"));
  }
  return lines;
}

// Scanned PDFs carry the page as an embedded JPEG. Return the largest one (base64), or null.
export async function scanImage(bytes: Uint8Array): Promise<string | null> {
  const doc = await PDFDocument.load(bytes);
  let best: Uint8Array | null = null;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image") || obj.dict.get(PDFName.of("Filter")) !== PDFName.of("DCTDecode")) continue;
    if (!best || obj.contents.length > best.length) best = obj.contents;
  }
  return best ? Buffer.from(best).toString("base64") : null;
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
