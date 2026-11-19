import { aiProvider, modelName } from "@/providers/llm";
import { json } from "../../../server";

export function GET() {
  const p = aiProvider();
  return json({ provider: p, textModel: p ? modelName() : null, scanModel: p ? modelName({ imageB64: "x" }) : null });
}
