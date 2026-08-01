import { ChatMessage } from "./openrouter";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export class OllamaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// Ollama's /api/chat expects plain string content per message — it doesn't
// speak the OpenAI-style multimodal content-array format. Flatten any image
// parts out (Ollama models in this registry aren't marked vision-capable,
// so a vision request should never reach this function anyway).
function flatten(messages: ChatMessage[]): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
  }));
}

export async function callOllama(tag: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, messages: flatten(messages), stream: false }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OllamaError(`Ollama ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const content = data?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OllamaError("Ollama returned an empty response.");
  }
  return content;
}
