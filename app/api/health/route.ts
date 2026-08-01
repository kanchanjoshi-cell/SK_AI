import { NextResponse } from "next/server";
import { getModelStatsSnapshot } from "@/lib/router";
import { MODEL_REGISTRY } from "@/lib/models";

export const runtime = "nodejs";

export async function GET() {
  const stats = getModelStatsSnapshot();
  return NextResponse.json({
    models: MODEL_REGISTRY.map((m) => ({
      id: m.id,
      label: m.label,
      family: m.family,
      free: m.free,
      contextWindow: m.contextWindow,
      ...stats.find((s) => s.id === m.id),
    })),
  });
}
