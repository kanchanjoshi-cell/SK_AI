// SK_AI provider registry — plugin-style model catalog.
//
// Two providers are wired in:
//   - "openrouter" (default) — covers OpenAI, Anthropic, Google, DeepSeek,
//     Meta, NVIDIA, Xiaomi, and 300+ others behind one gateway/key.
//   - "ollama" — models running locally via Ollama (http://localhost:11434).
//     No API key, but the model must actually be pulled (`ollama pull <tag>`)
//     or it's filtered out of ranking automatically (see lib/discovery.ts).
//
// Free-tier OpenRouter model IDs rotate fairly often. If a model in this list
// starts returning 404s, check https://openrouter.ai/models for a current
// replacement and swap the `id` field — nothing else needs to change.

export type TaskCategory =
  | "coding"
  | "writing"
  | "research"
  | "math_reasoning"
  | "long_document"
  | "translation"
  | "general";

export interface ModelSpec {
  id: string; // unique key; for OpenRouter models this is the exact model slug
  label: string; // shown in the UI
  family: string; // provider family, for the "user preference" score
  free: boolean;
  costTier: 0 | 1 | 2 | 3; // 0 = free, 3 = premium — used for the cost score
  contextWindow: number; // tokens, approximate
  vision?: boolean; // can this model accept image input?
  provider?: "openrouter" | "ollama"; // defaults to "openrouter" if omitted
  ollamaTag?: string; // the exact tag Ollama expects (only for provider: "ollama")
  strengths: Partial<Record<TaskCategory, number>>; // 0-1 task-match score
}

export const MODEL_REGISTRY: ModelSpec[] = [
  // ---- OpenRouter: general / writing ----
  {
    id: "openai/gpt-5.4-nano:free",
    label: "GPT-5.4 Nano",
    family: "openai",
    free: true,
    costTier: 0,
    contextWindow: 128_000,
    strengths: { general: 0.85, writing: 0.7, translation: 0.75, research: 0.6 },
  },
  {
    id: "anthropic/claude-opus-4-6-1m",
    label: "Claude Opus 4.6",
    family: "anthropic",
    free: false,
    costTier: 3,
    contextWindow: 1_000_000,
    strengths: {
      writing: 0.97,
      research: 0.93,
      long_document: 0.97,
      math_reasoning: 0.85,
      coding: 0.85,
      general: 0.9,
    },
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    family: "google",
    free: false,
    costTier: 1,
    contextWindow: 1_000_000,
    vision: true,
    strengths: { general: 0.85, research: 0.8, long_document: 0.85, writing: 0.75, translation: 0.8 },
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B",
    family: "google",
    free: true,
    costTier: 0,
    contextWindow: 262_000,
    vision: true,
    strengths: { general: 0.7, writing: 0.6, research: 0.55, translation: 0.6 },
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B",
    family: "meta",
    free: true,
    costTier: 0,
    contextWindow: 128_000,
    strengths: { general: 0.75, writing: 0.6, translation: 0.65, coding: 0.5 },
  },

  // ---- OpenRouter: coding / reasoning ----
  {
    id: "poolside/laguna-m.1:free",
    label: "Laguna M.1 Coder",
    family: "poolside",
    free: true,
    costTier: 0,
    contextWindow: 262_000,
    strengths: { coding: 0.95, math_reasoning: 0.55, general: 0.5 },
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    family: "deepseek",
    free: false,
    costTier: 1,
    contextWindow: 128_000,
    strengths: { coding: 0.93, math_reasoning: 0.85, general: 0.7 },
  },
  {
    id: "deepseek/deepseek-r1-distill:free",
    label: "DeepSeek R1 Distill",
    family: "deepseek",
    free: true,
    costTier: 0,
    contextWindow: 64_000,
    strengths: { math_reasoning: 0.9, coding: 0.7, research: 0.6, general: 0.55 },
  },

  // ---- OpenRouter: vision / long-document ----
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    label: "Nemotron 3 Nano Omni",
    family: "nvidia",
    free: true,
    costTier: 0,
    contextWindow: 300_000,
    vision: true,
    strengths: { long_document: 0.9, research: 0.75, general: 0.6 },
  },
  {
    id: "xiaomi/mimo-v2.5",
    label: "MiMo V2.5",
    family: "xiaomi",
    free: false,
    costTier: 1,
    contextWindow: 128_000,
    vision: true,
    strengths: { general: 0.75, research: 0.7, long_document: 0.7 },
  },

  // ---- OpenRouter: catch-all meta-router ----
  {
    id: "openrouter/auto",
    label: "OpenRouter Auto",
    family: "openrouter",
    free: false,
    costTier: 1,
    contextWindow: 128_000,
    vision: true,
    strengths: {
      general: 0.5,
      writing: 0.5,
      research: 0.5,
      coding: 0.5,
      math_reasoning: 0.5,
      long_document: 0.5,
      translation: 0.5,
    },
  },

  // ---- Ollama: local models (free, but only usable if actually pulled) ----
  // These only enter ranking if Ollama is running on localhost:11434 AND
  // `ollama pull <tag>` has been run for that tag — see lib/discovery.ts.
  {
    id: "ollama/llama3.2",
    label: "Llama 3.2 (local)",
    family: "ollama",
    free: true,
    costTier: 0,
    contextWindow: 128_000,
    provider: "ollama",
    ollamaTag: "llama3.2",
    strengths: { general: 0.65, writing: 0.55, coding: 0.5 },
  },
  {
    id: "ollama/deepseek-r1",
    label: "DeepSeek R1 (local)",
    family: "ollama",
    free: true,
    costTier: 0,
    contextWindow: 64_000,
    provider: "ollama",
    ollamaTag: "deepseek-r1",
    strengths: { math_reasoning: 0.8, coding: 0.7, general: 0.5 },
  },
  {
    id: "ollama/mistral",
    label: "Mistral (local)",
    family: "ollama",
    free: true,
    costTier: 0,
    contextWindow: 32_000,
    provider: "ollama",
    ollamaTag: "mistral",
    strengths: { general: 0.6, writing: 0.5 },
  },
];

export function getModel(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}
