import { MODEL_REGISTRY, ModelSpec, TaskCategory } from "./models";
import { Classification } from "./classifier";
import { getAvailableModels, getOllamaModels } from "./discovery";

// ---- Health Monitor ---------------------------------------------------
// In-memory per-model stats, updated after every real call this server
// makes. Not seeded with fake numbers — a fresh model starts "unproven"
// and its health score is earned (or lost) from actual traffic.
//
// A model that 404s isn't just "unhealthy" — it's gone (renamed, removed,
// or moved behind a paywall). Those get marked `unavailable` and are
// skipped entirely until the next discovery refresh gives them a chance
// to come back. A 429 is temporary — it just gets a bad health score for
// a while, it's never marked unavailable.

interface ModelStats {
  successes: number;
  failures: number;
  emaLatencyMs: number | null;
  lastError?: string;
  lastCheck: number;
  unavailable: boolean;
  unavailableSince?: number;
}

const stats = new Map<string, ModelStats>();
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000; // retry a "gone" model after an hour

function getStats(id: string): ModelStats {
  let s = stats.get(id);
  if (!s) {
    s = { successes: 0, failures: 0, emaLatencyMs: null, lastCheck: 0, unavailable: false };
    stats.set(id, s);
  }
  return s;
}

export function recordSuccess(id: string, latencyMs: number) {
  const s = getStats(id);
  s.successes += 1;
  s.emaLatencyMs = s.emaLatencyMs === null ? latencyMs : s.emaLatencyMs * 0.7 + latencyMs * 0.3;
  s.lastCheck = Date.now();
  s.lastError = undefined;
  s.unavailable = false; // it just worked, so it's clearly back
}

/**
 * Record a failed call. `status` drives how harshly we react:
 * - 404 (model renamed/removed) → mark unavailable, skip until cooldown expires
 * - 402/403 (now paid / no access) → mark unavailable the same way
 * - 429 (rate limited) → NOT unavailable, just a temporary health hit; it'll
 *   naturally rank lower for a bit and recover on the next success
 * - anything else → temporary health hit only
 */
export function recordFailure(id: string, error: string, status?: number) {
  const s = getStats(id);
  s.failures += 1;
  s.lastCheck = Date.now();
  s.lastError = error;

  if (status === 404 || status === 402 || status === 403) {
    s.unavailable = true;
    s.unavailableSince = Date.now();
  }
}

function isCooledDown(s: ModelStats): boolean {
  if (!s.unavailable) return true;
  if (!s.unavailableSince) return true;
  return Date.now() - s.unavailableSince > UNAVAILABLE_COOLDOWN_MS;
}

function healthScore(id: string): number {
  const s = getStats(id);
  if (s.unavailable && !isCooledDown(s)) return 0;
  const total = s.successes + s.failures;
  if (total === 0) return 0.75; // unproven models get a neutral-optimistic score
  const successRate = s.successes / total;
  const recentPenalty = s.failures > 0 && s.successes === 0 ? 0.4 : 1;
  return Math.max(0.05, successRate * recentPenalty);
}

function latencyScore(id: string): number {
  const s = getStats(id);
  if (s.emaLatencyMs === null) return 0.6; // unknown latency, mid-score
  return Math.max(0.05, Math.min(1, 1 - s.emaLatencyMs / 5500));
}

function costScore(model: ModelSpec): number {
  return [1, 0.7, 0.4, 0.15][model.costTier];
}

function taskMatchScore(model: ModelSpec, category: TaskCategory): number {
  return model.strengths[category] ?? 0.3;
}

export interface RankedModel {
  model: ModelSpec;
  score: number;
  breakdown: { taskMatch: number; health: number; latency: number; cost: number; preference: number };
}

// Weights straight from the blueprint's "Core Algorithm" section.
const WEIGHTS = { taskMatch: 0.4, health: 0.25, latency: 0.15, cost: 0.1, preference: 0.1 };

export async function rankModels(
  classification: Classification,
  preferredFamily?: string,
  needsVision?: boolean
): Promise<RankedModel[]> {
  const [{ models: liveModels, fresh }, ollama] = await Promise.all([
    getAvailableModels(),
    getOllamaModels(),
  ]);

  const ranked = MODEL_REGISTRY.map((model) => {
    const taskMatch = taskMatchScore(model, classification.category);
    const health = healthScore(model.id);
    const latency = latencyScore(model.id);
    const cost = costScore(model);
    const preference = preferredFamily && model.family === preferredFamily ? 1 : 0.5;

    const score =
      taskMatch * WEIGHTS.taskMatch +
      health * WEIGHTS.health +
      latency * WEIGHTS.latency +
      cost * WEIGHTS.cost +
      preference * WEIGHTS.preference;

    return { model, score, breakdown: { taskMatch, health, latency, cost, preference } };
  });

  const filtered = ranked.filter((r) => {
    const s = getStats(r.model.id);
    if (s.unavailable && !isCooledDown(s)) return false; // 404/402/403'd recently, skip
    if (classification.needsLongContext && r.model.contextWindow < 32_000) return false;
    if (needsVision && !r.model.vision) return false;

    if (r.model.provider === "ollama") {
      // Only usable if Ollama is actually running AND this exact tag has been pulled.
      if (!ollama.reachable) return false;
      if (!r.model.ollamaTag || !ollama.tags.has(r.model.ollamaTag)) return false;
      return true;
    }

    // Only trust live discovery as a hard filter when the fetch actually succeeded —
    // "openrouter/auto" is a meta-router and deliberately not in the discovery list.
    if (fresh && liveModels.size > 0 && r.model.id !== "openrouter/auto" && !liveModels.has(r.model.id)) {
      return false;
    }
    return true;
  });

  return (filtered.length ? filtered : ranked).sort((a, b) => b.score - a.score);
}

export function getModelStatsSnapshot() {
  return MODEL_REGISTRY.map((m) => {
    const s = getStats(m.id);
    const total = s.successes + s.failures;
    return {
      id: m.id,
      label: m.label,
      family: m.family,
      calls: total,
      successRate: total ? Math.round((s.successes / total) * 100) : null,
      avgLatencyMs: s.emaLatencyMs ? Math.round(s.emaLatencyMs) : null,
      lastError: s.lastError ?? null,
      unavailable: s.unavailable && !isCooledDown(s),
    };
  });
}
