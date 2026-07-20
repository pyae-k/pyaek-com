// AI assist: two providers behind one interface.
//   • Ollama  — local HTTP API (GET /api/tags, POST /api/chat). Start Ollama with
//     `OLLAMA_ORIGINS=*` so the browser can call it.
//   • Claude  — Anthropic Messages API (default model claude-sonnet-4-6). The
//     browser call uses the `anthropic-dangerous-direct-browser-access` header so
//     the user's own API key works client-side.
// Settings persist in localStorage. Pure helpers (stripCodeFences, systemPrompt,
// normalizeBaseUrl) are unit-tested; the network calls are not.
//
// Ported from pwa_duckdb/js/ai-assist.js, extended with a Claude provider.

const SETTINGS_KEY = "pwa_etl_ai_settings";

export type AiProvider = "ollama" | "claude" | "openai" | "gemini" | "groq" | "openrouter";
export type AiKind = "sql" | "expr";
export type OllamaMode = "manual" | "auto";
export type OllamaSize = "auto" | "tiny" | "small" | "medium" | "large";

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string; // Ollama
  model: string; // Ollama concrete tag used for generation
  ollamaMode: OllamaMode;
  ollamaFamily: string;
  ollamaSize: OllamaSize;
  claudeApiKey: string;
  claudeModel: string;
  claudeBaseUrl: string;
  // OpenAI
  openaiApiKey: string;
  openaiModel: string;
  // Gemini
  geminiApiKey: string;
  geminiModel: string;
  // Groq
  groqApiKey: string;
  groqModel: string;
  // OpenRouter
  openrouterApiKey: string;
  openrouterModel: string;
  // Shared
  temperature: number;
  maxTokens: number;
}

export interface HardwareProfile {
  cores: number;
  ramGB: number | null;
  tier: "low" | "medium" | "high";
}

export interface ModelCatalogEntry {
  tagSuffix: string;
  params: number;
  ramGB: number;
  label: string;
}

const DEFAULT_SETTINGS: AiSettings = {
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
  ollamaMode: "auto",
  ollamaFamily: "gemma",
  ollamaSize: "auto",
  claudeApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  claudeBaseUrl: "https://api.anthropic.com",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
  geminiApiKey: "",
  geminiModel: "gemini-2.0-flash",
  groqApiKey: "",
  groqModel: "llama-3.3-70b",
  openrouterApiKey: "",
  openrouterModel: "openai/gpt-4o",
  temperature: 0.1,
  maxTokens: 1024,
};

export function getAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = { ...getAiSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// --- Offline model catalog & performance-based suggestions ------------------

/** Common Ollama families with parameter-size tiers and rough RAM guidance.
 *  The tags below are suffixes; the full tag is resolved against what the
 *  user has installed (e.g. gemma3:4b). Sizes are conservative. */
export const OLLAMA_MODEL_CATALOG: Record<string, ModelCatalogEntry[]> = {
  gemma: [
    { tagSuffix: "2b", params: 2, ramGB: 4, label: "Fast / low memory" },
    { tagSuffix: "4b", params: 4, ramGB: 6, label: "Balanced" },
    { tagSuffix: "7b", params: 7, ramGB: 8, label: "Good quality" },
    { tagSuffix: "9b", params: 9, ramGB: 10, label: "Better quality" },
    { tagSuffix: "12b", params: 12, ramGB: 14, label: "High quality" },
    { tagSuffix: "27b", params: 27, ramGB: 24, label: "Best quality / heavy" },
  ],
  llama3: [
    { tagSuffix: "8b", params: 8, ramGB: 8, label: "Balanced" },
    { tagSuffix: "70b", params: 70, ramGB: 48, label: "High quality / heavy" },
  ],
  mistral: [
    { tagSuffix: "7b", params: 7, ramGB: 8, label: "Balanced" },
  ],
  phi3: [
    { tagSuffix: "mini", params: 4, ramGB: 4, label: "Fast / low memory" },
    { tagSuffix: "medium", params: 14, ramGB: 16, label: "High quality" },
  ],
};

/** Heuristic RAM estimate from CPU core count when deviceMemory is unavailable. */
function ramEstimateFromCores(cores: number): number {
  // Very conservative mapping. Most modern machines with 8+ cores have at least 8 GB.
  if (cores <= 2) return 4;
  if (cores <= 4) return 6;
  if (cores <= 8) return 8;
  return 16;
}

export function detectHardwareProfile(): HardwareProfile {
  let cores = 1;
  let ramGB: number | null = null;
  try {
    cores = navigator.hardwareConcurrency || 1;
  } catch { /* ignore */ }
  try {
    // deviceMemory is non-standard and only available in some Chromium browsers.
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (dm) ramGB = dm;
  } catch { /* ignore */ }
  const effectiveRam = ramGB ?? ramEstimateFromCores(cores);

  let tier: HardwareProfile["tier"] = "low";
  if (effectiveRam >= 16 && cores >= 8) tier = "high";
  else if (effectiveRam >= 8 && cores >= 4) tier = "medium";

  return { cores, ramGB, tier };
}

/** Pick the best installed tag for a family based on hardware and size preference. */
export function suggestOllamaModel(
  models: string[],
  family: string,
  profile: HardwareProfile,
  size: OllamaSize = "auto",
): string | null {
  const catalog = OLLAMA_MODEL_CATALOG[family.toLowerCase()];
  if (!catalog) return resolveLatestFamilyTag(models, family);

  const familyTags = models.filter((m) => matchesFamily(m, family));
  if (!familyTags.length) return resolveLatestFamilyTag(models, family);

  // If a specific size is requested, pick the closest catalog entry that is installed,
  // preferring the latest version of that size.
  if (size !== "auto") {
    const order = size === "tiny" ? catalog : [...catalog].reverse();
    const chosen = order.find((e) => familyTags.some((t) => t.endsWith(`:${e.tagSuffix}`)));
    if (chosen) {
      const candidates = familyTags.filter((t) => t.endsWith(`:${chosen.tagSuffix}`));
      return resolveLatestFamilyTag(candidates, family);
    }
  }

  // Auto: prefer the largest model the user likely has RAM for, but cap by tier.
  // Within the same parameter size, prefer the latest version (gemma3 over gemma2).
  const targetRam = profile.ramGB ?? ramEstimateFromCores(profile.cores);
  // Leave headroom for OS + browser + DuckDB (about 4 GB).
  const usableRam = Math.max(4, targetRam - 4);
  let best: { tag: string; entry: ModelCatalogEntry } | null = null;
  for (const entry of catalog) {
    if (entry.ramGB > usableRam) continue;
    const candidates = familyTags.filter((t) => t.endsWith(`:${entry.tagSuffix}`));
    const tag = candidates.length ? resolveLatestFamilyTag(candidates, family) : null;
    if (tag && (!best || entry.params > best.entry.params)) {
      best = { tag, entry };
    }
  }
  // Fall back to the smallest installed tag of the family.
  if (!best) {
    const smallest = [...catalog].find((e) => familyTags.some((t) => t.endsWith(`:${e.tagSuffix}`)));
    if (smallest) {
      const candidates = familyTags.filter((t) => t.endsWith(`:${smallest.tagSuffix}`));
      return candidates.length ? resolveLatestFamilyTag(candidates, family) : null;
    }
  }
  return best?.tag ?? resolveLatestFamilyTag(models, family);
}

function matchesFamily(tag: string, family: string): boolean {
  const lower = tag.toLowerCase();
  const fam = family.toLowerCase();
  // e.g. "gemma3:4b" or "gemma2:2b" both match "gemma".
  return lower.startsWith(fam) && (lower.length === fam.length || /\d/.test(lower[fam.length]));
}

/** Find the highest-version installed tag for a family, preferring :latest. */
export function resolveLatestFamilyTag(models: string[], family: string): string | null {
  const matches = models.filter((m) => matchesFamily(m, family));
  if (!matches.length) return null;
  // Prefer an exact "latest" tag if present.
  const latest = matches.find((m) => m.endsWith(":latest"));
  if (latest) return latest;
  // Otherwise sort by version number extracted from the name and pick the first.
  const scored = matches.map((m) => {
    const namePart = m.split(":")[0] ?? m;
    const versionMatch = namePart.match(/(\d+)/);
    const version = versionMatch ? parseInt(versionMatch[1], 10) : 0;
    const sizeMatch = m.match(/:(\d+b|mini|medium|small|large)$/);
    const sizeScore = sizeMatch ? sizeMatch[1] : "";
    return { tag: m, version, sizeScore };
  });
  scored.sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    // Prefer larger parameter sizes within the same version for quality.
    return sizeScore(b.sizeScore) - sizeScore(a.sizeScore);
  });
  return scored[0]?.tag ?? null;
}

function sizeScore(size: string): number {
  if (size.endsWith("b")) {
    const n = parseInt(size.slice(0, -1), 10);
    return isNaN(n) ? 0 : n;
  }
  const map: Record<string, number> = { mini: 4, small: 7, medium: 14, large: 27 };
  return map[size] ?? 0;
}

export function suggestionLabel(entry: ModelCatalogEntry, profile: HardwareProfile): string {
  const fits = profile.ramGB === null || entry.ramGB <= profile.ramGB;
  if (!fits) return `Requires ~${entry.ramGB} GB RAM`;
  if (entry.params <= 4) return `${entry.label} · fits your system`;
  if (entry.params <= 9) return `${entry.label} · recommended`;
  return `${entry.label} · high quality`;
}

export function exportModelCatalogEntryForTag(
  family: string,
  tag: string,
): ModelCatalogEntry | null {
  const catalog = OLLAMA_MODEL_CATALOG[family.toLowerCase()];
  if (!catalog) return null;
  const suffix = tag.split(":")[1] ?? "";
  return catalog.find((e) => e.tagSuffix === suffix) ?? null;
}

export function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

export function stripCodeFences(text: string): string {
  let t = String(text || "").trim();
  // ```sql\n ... ```  or  ```\n ... ```
  const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1];
  return t.trim();
}

export function systemPrompt(kind: AiKind, columns: string[], prevName: string): string {
  const colList = columns.length
    ? columns.map((c) => `"${c}"`).join(", ")
    : "(columns unknown — run a previous step first)";
  const prev = prevName || "prev";
  if (kind === "expr") {
    return [
      "You are a DuckDB expression expert.",
      "Convert the user's request into ONE DuckDB scalar expression to add as a new column.",
      "Return ONLY the expression — no SELECT, no FROM, no aliases, no explanation, no markdown fences.",
      "Available columns in the current row: " + colList + ".",
      "You may use CASE WHEN, arithmetic, string functions (LEFT, RIGHT, SUBSTRING, LENGTH, CONCAT, ||),",
      "dates (CURRENT_DATE, DATE_DIFF, EXTRACT), and window functions like SUM(...) OVER (PARTITION BY ...).",
      "Prefer simple, correct DuckDB syntax.",
    ].join(" ");
  }
  return [
    "You are a DuckDB SQL expert.",
    "Convert the user's request into a single DuckDB SELECT query.",
    `The previous step's result is available as the table/view \`${prev}\` — read from it, do not redefine it.`,
    "Available columns in " + prev + ": " + colList + ".",
    "Return ONLY valid DuckDB SQL — no explanation, no markdown fences, no trailing semicolon.",
    "Prefer SELECT from " + prev + ". CTEs (WITH) and window functions are fine.",
  ].join(" ");
}

export interface AiGenerateOpts {
  provider?: AiProvider;
  kind?: AiKind;
  prompt: string;
  columns?: string[];
  prevName?: string;
  baseUrl?: string;
  model?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  claudeBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function aiGenerate(opts: AiGenerateOpts): Promise<string> {
  const settings = getAiSettings();
  const provider = opts.provider ?? settings.provider;
  const userPrompt = String(opts.prompt || "").trim();
  if (!userPrompt) throw new Error("Describe what you want to generate.");

  const kind = opts.kind ?? "sql";
  const columns = opts.columns ?? [];
  const sys = systemPrompt(kind, columns, opts.prevName ?? "");

  switch (provider) {
    case "claude":
      return generateWithClaude(sys, userPrompt, {
        apiKey: opts.claudeApiKey ?? settings.claudeApiKey,
        model: opts.claudeModel ?? settings.claudeModel,
        baseUrl: opts.claudeBaseUrl ?? settings.claudeBaseUrl,
      });
    case "openai":
      return generateWithOpenAI(sys, userPrompt, {
        apiKey: opts.openaiApiKey ?? settings.openaiApiKey,
        model: opts.openaiModel ?? settings.openaiModel,
        temperature: opts.temperature ?? settings.temperature,
        maxTokens: opts.maxTokens ?? settings.maxTokens,
      });
    case "gemini":
      return generateWithGemini(sys, userPrompt, {
        apiKey: opts.geminiApiKey ?? settings.geminiApiKey,
        model: opts.geminiModel ?? settings.geminiModel,
      });
    case "groq":
      return generateWithGroq(sys, userPrompt, {
        apiKey: opts.groqApiKey ?? settings.groqApiKey,
        model: opts.groqModel ?? settings.groqModel,
        temperature: opts.temperature ?? settings.temperature,
        maxTokens: opts.maxTokens ?? settings.maxTokens,
      });
    case "openrouter":
      return generateWithOpenRouter(sys, userPrompt, {
        apiKey: opts.openrouterApiKey ?? settings.openrouterApiKey,
        model: opts.openrouterModel ?? settings.openrouterModel,
        temperature: opts.temperature ?? settings.temperature,
        maxTokens: opts.maxTokens ?? settings.maxTokens,
      });
    default: {
      // Ollama
      let model = (opts.model ?? settings.model).trim();
      if (settings.ollamaMode === "auto" || !model) {
        const base = normalizeBaseUrl(opts.baseUrl ?? settings.baseUrl);
        const models = await listOllamaModels(base);
        const family = settings.ollamaFamily || "gemma";
        const profile = detectHardwareProfile();
        const suggested = suggestOllamaModel(models, family, profile, settings.ollamaSize);
        if (!suggested) {
          throw new Error(
            `No installed ${family} model found. Pull one with: ollama pull ${family}:4b`,
          );
        }
        model = suggested;
      }
      return generateWithOllama(sys, userPrompt, {
        baseUrl: opts.baseUrl ?? settings.baseUrl,
        model,
      });
    }
  }
}

async function generateWithOllama(
  system: string,
  userPrompt: string,
  opts: { baseUrl: string; model: string },
): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl);
  const chosen = (opts.model || "").trim();
  if (!chosen) throw new Error("No Ollama model selected. Load models and pick one.");
  const url = `${base}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen,
        stream: false,
        options: { temperature: 0.1 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch {
    throw new Error(`Could not reach Ollama at ${url}. If this is a CORS error, start Ollama with OLLAMA_ORIGINS=*`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama /api/chat returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { message?: { content?: string }; response?: string };
  const content = data?.message?.content || data?.response || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("Ollama returned an empty response.");
  return cleaned;
}

async function generateWithClaude(
  system: string,
  userPrompt: string,
  opts: { apiKey: string; model: string; baseUrl: string },
): Promise<string> {
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) throw new Error("No Claude API key set. Add one in the AI panel settings.");
  const base = normalizeBaseUrl(opts.baseUrl);
  const model = (opts.model || "claude-sonnet-4-6").trim();
  const url = `${base}/v1/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch {
    throw new Error(`Could not reach Claude at ${url}. Check the base URL and your network.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { content?: Array<{ text?: string }> };
  const content = data?.content?.[0]?.text || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("Claude returned an empty response.");
  return cleaned;
}

async function generateWithOpenAI(
  system: string,
  userPrompt: string,
  opts: { apiKey: string; model: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) throw new Error("No OpenAI API key set. Add one in the AI panel settings.");
  const model = (opts.model || "gpt-4o").trim();
  const url = "https://api.openai.com/v1/chat/completions";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch {
    throw new Error(`Could not reach OpenAI at ${url}. Check your network.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI API returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("OpenAI returned an empty response.");
  return cleaned;
}

async function generateWithGemini(
  system: string,
  userPrompt: string,
  opts: { apiKey: string; model: string },
): Promise<string> {
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) throw new Error("No Gemini API key set. Add one in the AI panel settings.");
  const model = (opts.model || "gemini-2.0-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${system}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    });
  } catch {
    throw new Error(`Could not reach Gemini at ${url}. Check your network.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("Gemini returned an empty response.");
  return cleaned;
}

async function generateWithGroq(
  system: string,
  userPrompt: string,
  opts: { apiKey: string; model: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) throw new Error("No Groq API key set. Add one in the AI panel settings.");
  const model = (opts.model || "llama-3.3-70b").trim();
  const url = "https://api.groq.com/openai/v1/chat/completions";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch {
    throw new Error(`Could not reach Groq at ${url}. Check your network.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq API returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("Groq returned an empty response.");
  return cleaned;
}

async function generateWithOpenRouter(
  system: string,
  userPrompt: string,
  opts: { apiKey: string; model: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) throw new Error("No OpenRouter API key set. Add one in the AI panel settings.");
  const model = (opts.model || "openai/gpt-4o").trim();
  const url = "https://openrouter.ai/api/v1/chat/completions";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": "DuckDB ETL Studio",
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch {
    throw new Error(`Could not reach OpenRouter at ${url}. Check your network.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter API returned ${res.status}. ${detail}`.trim());
  }
  const data = await res.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content).replace(/;\s*$/, "");
  if (!cleaned) throw new Error("OpenRouter returned an empty response.");
  return cleaned;
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const base = normalizeBaseUrl(baseUrl);
  const url = `${base}/api/tags`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`Could not reach Ollama at ${url}. Is it running? For CORS errors, start Ollama with OLLAMA_ORIGINS=*`);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json().catch(() => ({})) as { models?: Array<{ name?: string; model?: string }> };
  const models = Array.isArray(data?.models) ? data.models : [];
  const names = models.map((m) => m.name || m.model).filter(Boolean) as string[];
  if (!names.length) throw new Error("No models installed in Ollama. Pull one with `ollama pull llama3`.");
  return names;
}