import { TaskCategory } from "./models";

export interface Classification {
  category: TaskCategory;
  confidence: number; // 0-1
  needsLongContext: boolean;
  signals: string[]; // which keywords/heuristics fired, shown in the routing trace
}

// Lightweight, deterministic classifier — the doc calls this "rule-based,
// upgrade to a trained classifier later." No extra model call, no added
// latency or cost for every single message.
const KEYWORD_RULES: Array<{ category: TaskCategory; patterns: RegExp[] }> = [
  {
    category: "coding",
    patterns: [
      /```/,
      /\b(function|class|const|import|bug|stack trace|exception|compile|regex|api|endpoint|refactor|unit test|algorithm|leetcode|css|react|python|typescript|javascript|sql)\b/i,
    ],
  },
  {
    category: "math_reasoning",
    patterns: [
      /\b(prove|theorem|integral|derivative|equation|probability|combinatorics|solve for|calculate|step by step reasoning|logic puzzle)\b/i,
      /\d+\s*[+\-*/^]\s*\d+/,
    ],
  },
  {
    category: "research",
    patterns: [
      /\b(research|compare|analyze|summarize findings|literature|sources|citations|study|dataset|evidence)\b/i,
    ],
  },
  {
    category: "translation",
    patterns: [/\b(translate|translation|in (spanish|french|german|hindi|japanese|chinese))\b/i],
  },
  {
    category: "writing",
    patterns: [
      /\b(write|draft|essay|poem|story|letter|email|blog post|article|resignation|cover letter|rewrite|proofread|tone)\b/i,
    ],
  },
];

export function classify(prompt: string): Classification {
  const signals: string[] = [];
  const scores: Partial<Record<TaskCategory, number>> = {};

  for (const rule of KEYWORD_RULES) {
    let hits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) {
        hits += 1;
        signals.push(`matched /${pattern.source.slice(0, 24)}.../ → ${rule.category}`);
      }
    }
    if (hits > 0) {
      scores[rule.category] = Math.min(1, 0.55 + hits * 0.2);
    }
  }

  const needsLongContext = prompt.length > 6000;
  if (needsLongContext) signals.push("prompt length > 6000 chars → long-document capability needed");

  let best: TaskCategory = "general";
  let bestScore = 0.4; // default confidence for the general bucket
  for (const [cat, score] of Object.entries(scores) as [TaskCategory, number][]) {
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }

  if (needsLongContext && best === "general") {
    best = "long_document";
    bestScore = 0.6;
  }

  if (signals.length === 0) signals.push("no strong signals → routed as general chat");

  return { category: best, confidence: bestScore, needsLongContext, signals };
}
