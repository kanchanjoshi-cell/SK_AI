export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export class OpenRouterError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// Calls a single model through OpenRouter's OpenAI-compatible endpoint.
// Throws OpenRouterError on any non-2xx response or network failure so the
// router above can record it and fail over to the next-ranked model.
export async function callOpenRouter(modelId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(
      "OPENROUTER_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter uses these for its public leaderboard attribution — optional but recommended.
      "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
      "X-Title": "SK_AI",
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OpenRouterError("OpenRouter returned an empty response.");
  }
  return content;
}
