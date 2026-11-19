import { docBytes } from "@/documents/erp";

export async function GET(_req: Request, { params }: { params: Promise<{ batch: string; id: string }> }) {
  const { batch, id } = await params;
  const bytes = docBytes(batch, id);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${id}.pdf"`, "cache-control": "public, max-age=86400" } });
}
