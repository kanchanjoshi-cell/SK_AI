"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface RoutingInfo {
  category: string;
  confidence: number;
  signals: string[];
  needsVision?: boolean;
  chosenModel?: { id: string; label: string; score: number };
  ranked?: { id: string; label: string; score: number }[];
  trace: { modelId: string; label: string; outcome: "success" | "failed"; error?: string; latencyMs?: number }[];
}

interface Message {
  role: Role;
  content: string | ContentPart[];
  displayText: string; // what we render in the bubble (never the raw file dump)
  routing?: RoutingInfo;
  error?: boolean;
  imagePreviews?: string[];
}

interface HealthRow {
  id: string;
  label: string;
  family: string;
  free: boolean;
  calls?: number;
  successRate?: number | null;
  avgLatencyMs?: number | null;
  lastError?: string | null;
  unavailable?: boolean;
}

interface Attachment {
  id: string;
  kind: "image" | "text";
  name: string;
  dataUrl?: string; // images
  textContent?: string; // text-based files
}

const FAMILIES = ["openai", "anthropic", "google", "poolside", "deepseek", "meta", "nvidia", "xiaomi", "ollama", "openrouter"];
const TEXT_EXTENSIONS = [
  ".txt", ".md", ".csv", ".json", ".js", ".jsx", ".ts", ".tsx", ".py", ".java",
  ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yaml", ".yml", ".log",
];
const MAX_TEXT_FILE_CHARS = 20_000;

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") return true;
  return TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

export default function ChatConsole() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preferredFamily, setPreferredFamily] = useState<string>("");
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data.models);
    } catch {
      // health panel is best-effort; ignore transient failures
    }
  };

  useEffect(() => {
    refreshHealth();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function addFiles(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((cur) => [...cur, { id, kind: "image", name: file.name, dataUrl: reader.result as string }]);
        };
        reader.readAsDataURL(file);
      } else if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = () => {
          const text = (reader.result as string).slice(0, MAX_TEXT_FILE_CHARS);
          setAttachments((cur) => [...cur, { id, kind: "text", name: file.name, textContent: text }]);
        };
        reader.readAsText(file);
      } else {
        // Unsupported binary type (e.g. .pdf, .docx) — attach the name only,
        // so at least the model knows a file was referenced.
        setAttachments((cur) => [
          ...cur,
          { id, kind: "text", name: file.name, textContent: `[File "${file.name}" attached — binary format not extracted, only the filename is available.]` },
        ]);
      }
    });
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }

  async function copyMessage(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
    } catch {
      // clipboard permission denied — silently ignore
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;

    const imageAttachments = attachments.filter((a) => a.kind === "image");
    const textAttachments = attachments.filter((a) => a.kind === "text");

    let textBlock = text;
    for (const t of textAttachments) {
      textBlock += `\n\n--- file: ${t.name} ---\n${t.textContent}\n---`;
    }

    let content: string | ContentPart[];
    if (imageAttachments.length > 0) {
      const parts: ContentPart[] = [];
      if (textBlock.trim()) parts.push({ type: "text", text: textBlock });
      for (const img of imageAttachments) {
        parts.push({ type: "image_url", image_url: { url: img.dataUrl! } });
      }
      content = parts;
    } else {
      content = textBlock;
    }

    const displayText = text || (attachments.length ? "(attachment)" : "");
    const userMsg: Message = {
      role: "user",
      content,
      displayText,
      imagePreviews: imageAttachments.map((a) => a.dataUrl!),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          preferredFamily: preferredFamily || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((cur) => [
          ...cur,
          {
            role: "assistant",
            content: data.error ?? "Every ranked provider failed for this request.",
            displayText: data.error ?? "Every ranked provider failed for this request.",
            routing: data.routing,
            error: true,
          },
        ]);
      } else {
        setMessages((cur) => [...cur, { role: "assistant", content: data.content, displayText: data.content, routing: data.routing }]);
      }
    } catch {
      setMessages((cur) => [
        ...cur,
        { role: "assistant", content: "Network error reaching SK_AI.", displayText: "Network error reaching SK_AI.", error: true },
      ]);
    } finally {
      setLoading(false);
      refreshHealth();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Routing console — left */}
      <aside className="hidden lg:flex w-[340px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal live-dot" />
            <h1 className="font-display text-lg tracking-tight">SK_AI</h1>
          </div>
          <p className="mt-1 text-xs text-text-muted">Routing console — one gateway, every model</p>
        </div>

        <div className="px-5 py-4 border-b border-border">
          <label className="text-xs uppercase tracking-wider text-text-muted">Preferred family</label>
          <select
            value={preferredFamily}
            onChange={(e) => setPreferredFamily(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-panel-alt px-2 py-1.5 text-sm font-mono outline-none focus:border-amber"
          >
            <option value="">No preference — score decides</option>
            {FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            Adds +0.10 weight to models from this family in the decision score. Doesn&apos;t override health or fallback.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto console-scroll px-5 py-4">
          <h2 className="text-xs uppercase tracking-wider text-text-muted mb-3">Provider health</h2>
          <div className="space-y-2">
            {health.map((m) => (
              <div key={m.id} className="rounded-md border border-border bg-panel-alt px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{m.label}</span>
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (m.unavailable
                        ? "bg-red"
                        : m.calls === 0 || m.calls === undefined
                        ? "bg-text-muted"
                        : (m.successRate ?? 0) >= 60
                        ? "bg-teal"
                        : "bg-red")
                    }
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[11px] text-text-muted">
                  <span>{m.unavailable ? "unavailable" : m.calls ? `${m.successRate}% ok` : "unproven"}</span>
                  <span>{m.avgLatencyMs ? `${m.avgLatencyMs}ms` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border text-[11px] text-text-muted">
          Task match 0.40 · Health 0.25 · Latency 0.15 · Cost 0.10 · Preference 0.10
        </div>
      </aside>

      {/* Chat — right */}
      <main className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto console-scroll">
          <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
            {messages.length === 0 && (
              <div className="rounded-lg border border-border bg-panel px-5 py-4 text-sm text-text-muted">
                Ask anything, paste or attach an image, or drop in a text/code file. SK_AI classifies the
                prompt, scores every model behind OpenRouter, and calls the winner — falling back
                automatically if it fails.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="space-y-2 group">
                {m.role === "assistant" && m.routing && <RoutingTrace routing={m.routing} />}
                <div
                  className={
                    "relative rounded-lg px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap " +
                    (m.role === "user"
                      ? "ml-auto max-w-[80%] bg-panel-alt border border-border"
                      : "max-w-[85%] " + (m.error ? "border border-red/40 bg-red/5 text-red" : "bg-transparent"))
                  }
                >
                  {m.imagePreviews && m.imagePreviews.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {m.imagePreviews.map((src, idx) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={idx} src={src} alt="attachment" className="h-24 w-24 rounded-md object-cover border border-border" />
                      ))}
                    </div>
                  )}
                  {m.displayText}

                  <button
                    onClick={() => copyMessage(m.displayText, i)}
                    className="absolute -top-2.5 right-2 hidden group-hover:flex items-center gap-1 rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text"
                    title="Copy"
                  >
                    {copiedIndex === i ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-amber live-dot" />
                classifying → scoring providers → calling winner…
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-panel px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-md border border-border bg-panel-alt px-2 py-1 text-xs">
                    {a.kind === "image" && a.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.dataUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <span className="text-amber">📄</span>
                    )}
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <button onClick={() => removeAttachment(a.id)} className="text-text-muted hover:text-red">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={onPickFiles}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mb-0.5 rounded-md border border-border bg-panel-alt px-3 py-2.5 text-sm text-text-muted hover:text-text hover:border-amber"
                title="Attach an image or file"
              >
                📎
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder="Ask anything… (paste an image, or attach a file)"
                rows={1}
                className="flex-1 resize-none rounded-md border border-border bg-panel-alt px-3 py-2.5 text-sm outline-none focus:border-amber"
              />
              <button
                onClick={send}
                disabled={loading || (!input.trim() && attachments.length === 0)}
                className="rounded-md bg-amber px-4 py-2.5 text-sm font-medium text-[#1a1200] disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function RoutingTrace({ routing }: { routing: RoutingInfo }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2 font-mono text-[11px] text-text-muted">
      <div className="trace-line">
        <span className="text-amber">task</span> {routing.category} ({Math.round(routing.confidence * 100)}%)
        {routing.needsVision && <span className="text-teal"> · vision required</span>}
      </div>
      {routing.trace.map((t, i) => (
        <div key={i} className="trace-line" style={{ animationDelay: `${i * 90}ms` }}>
          {t.outcome === "success" ? (
            <>
              <span className="text-teal">✓ winner</span> {t.label} · {t.latencyMs}ms
            </>
          ) : (
            <>
              <span className="text-red">✗ failed</span> {t.label} — {t.error?.slice(0, 60)} → falling back
            </>
          )}
        </div>
      ))}
    </div>
  );
}
