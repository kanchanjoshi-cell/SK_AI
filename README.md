# SK_AI

A working AI router: one chat interface that classifies each prompt and routes it
to the best-scoring model behind [OpenRouter](https://openrouter.ai), with real
health tracking, latency scoring, and automatic fallback if a model fails.

This is the MVP slice of the larger "AI-OS" blueprint (chat UI + provider layer +
intent detection + decision engine + health monitor + fallback), built to actually
run rather than stay a diagram. Everything else in the blueprint (agents, billing,
analytics, vector DB, mobile app, etc.) plugs in around this core later.

## Providers

SK_AI now has two real provider backends, dispatched per-model by `provider`
in `lib/models.ts`:

- **OpenRouter** (default) — one key, covers OpenAI (GPT-5.4 Nano), Anthropic
  (Claude Opus 4.6), Google (Gemini 3.5 Flash, Gemma 4), DeepSeek (V4 Pro,
  R1 Distill), Meta (Llama 3.3), NVIDIA (Nemotron Omni), Xiaomi (MiMo V2.5),
  Poolside (Laguna coder), and the `openrouter/auto` meta-router as a
  last-resort fallback.
- **Ollama** (`lib/ollama.ts`) — fully local, no API key. Calls
  `http://localhost:11434` directly. `lib/discovery.ts` checks
  `/api/tags` every 30 seconds; a local model only enters ranking if Ollama
  is actually running **and** that exact tag has been pulled
  (`ollama pull llama3.2`, `ollama pull deepseek-r1`, `ollama pull mistral`).
  If Ollama isn't running, these three are silently excluded — no error, no
  crash, just fewer candidates.

Adding a new OpenRouter model is a one-line entry in `MODEL_REGISTRY` (no
`provider` field needed — it defaults to OpenRouter). Adding a new Ollama
model is the same, plus `provider: "ollama"` and `ollamaTag: "<the pulled tag>"`.

## How it works

1. **Classify** (`lib/classifier.ts`) — a rule-based classifier reads the latest
   user message and tags it: coding, writing, research, math/reasoning,
   translation, long-document, or general. Attaching an image also flags the
   request as needing a vision-capable model.
2. **Discover** (`lib/discovery.ts`) — before ranking, the router fetches
   OpenRouter's live `/models` list (cached 10 minutes) and Ollama's local
   `/api/tags` (cached 30 seconds), and cross-checks the curated registry
   against both. A model that's been renamed or pulled off OpenRouter, or an
   Ollama tag that was never pulled, simply won't show up — so it's filtered
   out of ranking *before* SK_AI ever tries to call it, instead of finding
   out via a 404 mid-conversation. If a discovery fetch itself fails (network
   hiccup, or Ollama not running), it fails open for OpenRouter (falls back
   to per-call error handling) and fails closed for Ollama (that provider's
   models are just excluded — Ollama not running is a normal state, not an
   error).
3. **Rank** (`lib/router.ts`) — every surviving model gets a weighted score:
   `task match (0.40) + health (0.25) + latency (0.15) + cost (0.10) + preference (0.10)`.
   Health and latency are **real, in-memory stats** updated from actual calls
   this server makes — not seeded or faked.
4. **Call** (`lib/openrouter.ts` / `lib/ollama.ts`) — the top-ranked model is
   called through whichever backend its `provider` field points to.
5. **Fail over, intelligently** — a failure is handled differently by HTTP status:
   - **404 / 402 / 403** (model renamed, removed, or now paid-only) → marked
     `unavailable` immediately and skipped in every ranking for the next hour
     (then it's given another chance, in case it comes back).
   - **429** (rate limited) → treated as *temporary*: it takes a health hit
     and ranks lower for a while, but is never marked unavailable — it's
     usually back to normal on the next request.
   - Either way, the router tries the next-ranked model automatically (up to
     4 attempts), so one dead or throttled model doesn't break the conversation.

The left console shows the live routing trace (why a model was picked, and
why earlier candidates failed) and a health table for every model in the
registry — including a distinct "unavailable" state, not just a low success
rate.

## Attachments

- Click 📎 or paste (Ctrl+V) an image straight into the input — SK_AI routes
  those requests to vision-capable models only (currently Gemma 4 31B,
  Nemotron 3 Nano Omni, or OpenRouter Auto).
- Attach text/code files (.txt, .md, .csv, .json, .py, .js, etc.) — their
  content is appended to your message as context.
- Hover any message for a Copy button.

## Run it

**Easiest way:**
```bash
chmod +x start.sh
./start.sh
```
First run creates `.env.local` and stops so you can paste your OpenRouter key
(free at https://openrouter.ai/keys). Run `./start.sh` again after that and it
installs dependencies + starts the server in one go.

**Manual way:**
```bash
npm install
cp .env.example .env.local
# put your OpenRouter key in .env.local
npm run dev
```

Open http://localhost:3000.

## Add or swap a model

Everything is plugin-style — edit `lib/models.ts` only:

```ts
{
  id: "provider/model-slug",       // exact OpenRouter model id
  label: "Display Name",
  family: "provider-family",       // used for the preference score
  free: true,
  costTier: 0,                     // 0 free … 3 premium
  contextWindow: 128_000,
  strengths: { coding: 0.9, general: 0.6 },
}
```

No router, API route, or UI code needs to change. **Free-tier OpenRouter model
IDs rotate** — if one starts 404ing, check https://openrouter.ai/models and swap
the `id` field.

## What's deliberately not in this MVP yet

The blueprint doc's later phases — auth, Postgres-backed chat history, specialized
agents, tool calling, RAG/vector search, billing, admin dashboard, mobile app —
are real work items, not stubs. This MVP nails the foundation (chat + provider
interface + routing + health + fallback) the doc says to build first, so those
layers can be added around it without re-architecting the core.
