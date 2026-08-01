import { NextRequest, NextResponse } from "next/server";
import { classify } from "@/lib/classifier";
import { rankModels, recordSuccess, recordFailure } from "@/lib/router";
import { callOpenRouter, ChatMessage, OpenRouterError } from "@/lib/openrouter";
import { callOllama, OllamaError } from "@/lib/ollama";
import { ModelSpec } from "@/lib/models";

export const runtime = "nodejs";

interface ChatRequestBody {
  messages: ChatMessage[];
  preferredFamily?: string;
}

const MAX_FALLBACK_ATTEMPTS = 4;

function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function hasImage(content: ChatMessage["content"]): boolean {
  return Array.isArray(content) && content.some((p) => p.type === "image_url");
}

async function callModel(model: ModelSpec, messages: ChatMessage[]): Promise<string> {
  if (model.provider === "ollama") {
    if (!model.ollamaTag) throw new OllamaError("Ollama model is missing its tag.");
    return callOllama(model.ollamaTag, messages);
  }
  return callOpenRouter(model.id, messages);
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { messages, preferredFamily } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "`messages` must be a non-empty array." }, { status: 400 });
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const classification = classify(extractText(lastUserMessage?.content ?? ""));
  const needsVision = hasImage(lastUserMessage?.content ?? "");
  const ranked = await rankModels(classification, preferredFamily, needsVision);

  const trace: Array<{ modelId: string; label: string; outcome: "success" | "failed"; error?: string; latencyMs?: number }> = [];

  for (const candidate of ranked.slice(0, MAX_FALLBACK_ATTEMPTS)) {
    const start = Date.now();
    try {
      const content = await callModel(candidate.model, messages);
      const latencyMs = Date.now() - start;
      recordSuccess(candidate.model.id, latencyMs);
      trace.push({ modelId: candidate.model.id, label: candidate.model.label, outcome: "success", latencyMs });

      return NextResponse.json({
        content,
        routing: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals,
          needsVision,
          chosenModel: { id: candidate.model.id, label: candidate.model.label, score: candidate.score, breakdown: candidate.breakdown },
          ranked: ranked.slice(0, 5).map((r) => ({ id: r.model.id, label: r.model.label, score: Math.round(r.score * 1000) / 1000 })),
          trace,
        },
      });
    } catch (err) {
      const status = err instanceof OpenRouterError || err instanceof OllamaError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      recordFailure(candidate.model.id, message, status);
      trace.push({
        modelId: candidate.model.id,
        label: candidate.model.label,
        outcome: "failed",
        error: status === 404 ? `${message} (model no longer exists — marked unavailable)` : message,
      });
      // continue to next-ranked model — automatic failover
    }
  }

  return NextResponse.json(
    {
      error: needsVision
        ? "Every ranked vision-capable provider failed for this request."
        : "Every ranked provider failed for this request.",
      routing: { category: classification.category, confidence: classification.confidence, signals: classification.signals, needsVision, trace },
    },
    { status: 502 }
  );
}
