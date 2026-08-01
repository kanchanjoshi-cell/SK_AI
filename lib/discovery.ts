// Live model discovery against OpenRouter's /models endpoint.
//
// The curated list in models.ts still holds the *judgment calls* (which
// model is good at coding vs writing) — OpenRouter has no opinion on that.
// But it DOES know, right now, which model IDs actually exist. This file
// fetches that list so the router can tell "renamed/removed/paid-only"
// apart from "temporarily rate-limited", instead of hardcoding IDs forever
// and hoping they stay valid.

export interface DiscoveredModel {
  id: string;
  contextLength?: number;
}

interface DiscoveryCache {
  models: Map<string, DiscoveredModel>;
  fetchedAt: number;
  ok: boolean; // false if the last fetch attempt failed
}

let cache: DiscoveryCache | null = null;
const TTL_MS = 10 * 60 * 1000; // refresh every 10 minutes

async function fetchFromOpenRouter(): Promise<Map<string, DiscoveredModel>> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter /models responded ${res.status}`);
  const data = await res.json();
  const map = new Map<string, DiscoveredModel>();
  for (const m of data?.data ?? []) {
    if (typeof m?.id === "string") {
      map.set(m.id, { id: m.id, contextLength: m.context_length });
    }
  }
  return map;
}

/**
 * Returns the current live model catalog, refreshing it in the background
 * if the cache is stale. Never throws: on a failed fetch it returns the
 * previous cache (or an empty map on first-ever failure) so a network
 * hiccup can't take the whole router down — it just fails open and lets
 * per-call 404 handling catch anything that's actually gone.
 */
export async function getAvailableModels(): Promise<{ models: Map<string, DiscoveredModel>; fresh: boolean }> {
  const isStale = !cache || Date.now() - cache.fetchedAt > TTL_MS;
  if (!isStale) return { models: cache!.models, fresh: cache!.ok };

  try {
    const models = await fetchFromOpenRouter();
    cache = { models, fetchedAt: Date.now(), ok: true };
    return { models, fresh: true };
  } catch {
    // Fetch failed — keep serving the old cache (if any) so a transient
    // network blip doesn't disqualify every model at once.
    if (cache) {
      cache = { ...cache, fetchedAt: Date.now() }; // avoid hammering on every request
      return { models: cache.models, fresh: false };
    }
    cache = { models: new Map(), fetchedAt: Date.now(), ok: false };
    return { models: new Map(), fresh: false };
  }
}

// ---- Ollama discovery ---------------------------------------------------
// Local infra, not a shared public API — checked much more often since the
// user might pull/remove models mid-session, and a dead check just means
// "Ollama isn't running right now", not a network incident worth caching long.

interface OllamaCache {
  tags: Set<string>;
  reachable: boolean;
  fetchedAt: number;
}

let ollamaCache: OllamaCache | null = null;
const OLLAMA_TTL_MS = 30 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export async function getOllamaModels(): Promise<{ tags: Set<string>; reachable: boolean }> {
  const isStale = !ollamaCache || Date.now() - ollamaCache.fetchedAt > OLLAMA_TTL_MS;
  if (!isStale) return { tags: ollamaCache!.tags, reachable: ollamaCache!.reachable };

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`Ollama /api/tags responded ${res.status}`);
    const data = await res.json();
    const tags = new Set<string>();
    for (const m of data?.models ?? []) {
      if (typeof m?.name === "string") {
        tags.add(m.name);
        tags.add(m.name.split(":")[0]); // also match the tag without ":latest" etc.
      }
    }
    ollamaCache = { tags, reachable: true, fetchedAt: Date.now() };
    return { tags, reachable: true };
  } catch {
    // Ollama isn't running, or isn't installed — that's a completely normal
    // state, not an error. Ollama models are simply excluded from ranking.
    ollamaCache = { tags: new Set(), reachable: false, fetchedAt: Date.now() };
    return { tags: new Set(), reachable: false };
  }
}
