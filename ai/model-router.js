// model-router.js — streaming-capable model router for ChatAI.
// Selects the best enabled connection per task, normalizes requests for
// non-OpenAI providers, consumes streaming responses, and falls back on failure.

import { typeById } from "./providers.js";

// Capability tags used by the router to score connections.
export const TAG_WEIGHTS = {
  coding: 1.0,
  reasoning: 1.0,
  vision: 1.0,
  fast: 0.8,
  cheap: 0.8,
  long_context: 0.7,
  local: 0.5,
};

// Default provider priority by task tag. First = best match.
const DEFAULT_TASK_PRIORITIES = {
  chat: ["openai", "anthropic", "gemini", "zhipu", "qwen", "moonshot", "groq", "ollama"],
  cheap: ["gemini", "groq", "ollama", "openai", "zhipu", "qwen"],
  fast: ["groq", "gemini", "openai", "anthropic"],
  coding: ["qwen", "moonshot", "anthropic", "openai", "groq", "ollama", "zhipu"],
  reasoning: ["anthropic", "deepseek", "openai", "gemini", "qwen"],
  vision: ["openai", "gemini", "anthropic"],
  long_context: ["anthropic", "gemini", "moonshot", "openai"],
  write: ["anthropic", "openai", "gemini", "moonshot", "qwen"],
  research: ["anthropic", "openai", "deepseek", "gemini", "qwen", "zhipu"],
};

// Per-connection health, kept in memory only.
const health = new Map();

function recordHealth(connectionId, success, latencyMs) {
  const h = health.get(connectionId) || { success: 0, failure: 0, lastLatency: 0 };
  if (success) {
    h.success += 1;
    h.lastLatency = latencyMs;
  } else {
    h.failure += 1;
  }
  health.set(connectionId, h);
}

function getHealth(connectionId) {
  return health.get(connectionId) || { success: 0, failure: 0, lastLatency: 0 };
}

function chatConnections(settings) {
  return (settings.connections || []).filter((c) => c.enabled !== false && !isSpecialType(c.type));
}

function isSpecialType(typeId) {
  const t = typeById(typeId);
  return !!(t?.isAudio || t?.isImage || t?.isSearch || t?.isEmbedding);
}

export function getEnabledConnections(settings) {
  return chatConnections(settings);
}

// Pick the best connection for a task. Returns an array sorted by preference.
export function rankConnections({ settings, task = "chat", excludeIds = [] } = {}) {
  const enabled = chatConnections(settings).filter((c) => !excludeIds.includes(c.id));
  if (!enabled.length) return [];

  const priorityList = DEFAULT_TASK_PRIORITIES[task] || DEFAULT_TASK_PRIORITIES.chat;

  const scored = enabled.map((c) => {
    const type = typeById(c.type);
    const tags = new Set([...(type?.tags || []), ...(c.tags || [])]);
    let score = 0;

    // Provider-type priority
    const typeRank = priorityList.indexOf(c.type);
    score += typeRank >= 0 ? (priorityList.length - typeRank) * 10 : 0;

    // Tag bonuses
    for (const tag of tags) {
      if (TAG_WEIGHTS[tag]) score += TAG_WEIGHTS[tag] * 5;
    }
    if (task && tags.has(task)) score += 15;

    // Health penalties
    const h = getHealth(c.id);
    score -= h.failure * 20;
    score -= h.success === 0 ? 2 : 0; // slight preference for proven connections

    return { connection: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.connection);
}

export function selectConnection(options) {
  return rankConnections(options)[0] || null;
}

// Normalize a chat request into provider-specific body/headers.
function normalizeRequest(connection, messages, options = {}) {
  const type = typeById(connection.type);
  const model = connection.model || type?.defaultModel || "";
  const endpoint = connection.endpoint || type?.defaultEndpoint || "";
  const key = connection.key || "";

  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2048;
  const stream = options.stream ?? false;

  const headers = { "Content-Type": "application/json" };
  const keyRequired = type?.keyRequired ?? true;
  if (keyRequired && !key.trim()) {
    throw new Error(`${type?.label || connection.type} requires an API key`);
  }
  if (key.trim()) headers["Authorization"] = "Bearer " + key;

  // Anthropic Messages API needs its own body shape.
  if (connection.type === "anthropic" && endpoint.includes("/messages")) {
    const systemMsg = messages.find((m) => m.role === "system");
    const apiMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    const body = {
      model,
      messages: apiMessages,
      system: systemMsg?.content || undefined,
      max_tokens: maxTokens,
      temperature,
      stream,
    };
    // Anthropic uses x-api-key + anthropic-version.
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    delete headers["Authorization"];
    return { endpoint, headers, body };
  }

  // Azure OpenAI uses api-key header.
  if (connection.type === "azure") {
    headers["api-key"] = key;
    delete headers["Authorization"];
  }

  // Gemini via OpenAI-compatible endpoint already works with the standard body.
  // Ollama supports stream: true but returns JSON lines differently — handled below.

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  return { endpoint, headers, body };
}

// Parse an SSE stream chunk into a partial text delta.
function parseOpenAIStreamChunk(line) {
  const text = line.replace(/^data:\s*/, "").trim();
  if (!text || text === "[DONE]") return null;
  try {
    const json = JSON.parse(text);
    const delta = json?.choices?.[0]?.delta;
    return {
      content: delta?.content ?? delta?.text ?? "",
      finishReason: json?.choices?.[0]?.finish_reason,
    };
  } catch {
    return null;
  }
}

function parseAnthropicStreamChunk(line) {
  const text = line.replace(/^data:\s*/, "").trim();
  if (!text || text === "[DONE]") return null;
  try {
    const json = JSON.parse(text);
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
      return { content: json.delta.text || "", finishReason: null };
    }
    if (json.type === "message_stop") return { content: "", finishReason: "stop" };
    return null;
  } catch {
    return null;
  }
}

async function* streamResponse(connection, resp) {
  const type = typeById(connection.type);
  const isAnthropic = connection.type === "anthropic";
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const chunk = isAnthropic ? parseAnthropicStreamChunk(line) : parseOpenAIStreamChunk(line);
        if (!chunk) continue;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.content || chunk.finishReason) {
          yield { content: chunk.content || "", finishReason: chunk.finishReason, usage };
        }
      }
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      const chunk = isAnthropic ? parseAnthropicStreamChunk(buffer) : parseOpenAIStreamChunk(buffer);
      if (chunk) yield { content: chunk.content || "", finishReason: chunk.finishReason, usage };
    }
  } finally {
    reader.releaseLock();
  }
}

async function nonStreamResponse(connection, resp) {
  const type = typeById(connection.type);
  const data = await resp.json();

  // Anthropic Messages
  if (connection.type === "anthropic" && data.content) {
    const text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { content: text, usage: data.usage || null };
  }

  const content =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content ?? "";
  return { content, usage: data?.usage || null };
}

// Core call. Supports both streaming and non-streaming.
export async function callModel({ connection, messages, signal, onChunk, options = {} } = {}) {
  const start = performance.now();
  const stream = options.stream ?? false;

  let resp;
  try {
    const { endpoint, headers, body } = normalizeRequest(connection, messages, { ...options, stream });

    resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
  } catch (err) {
    recordHealth(connection.id, false, 0);
    throw err;
  }

  if (stream && resp.body) {
    let content = "";
    let lastUsage = null;
    for await (const chunk of streamResponse(connection, resp)) {
      if (chunk.content) {
        content += chunk.content;
        onChunk?.(chunk.content, content);
      }
      if (chunk.usage) lastUsage = chunk.usage;
      if (chunk.finishReason) break;
    }
    recordHealth(connection.id, true, performance.now() - start);
    return { content, usage: lastUsage, streamed: true };
  }

  const result = await nonStreamResponse(connection, resp);
  recordHealth(connection.id, true, performance.now() - start);
  return { ...result, streamed: false };
}

// Higher-level: call with automatic model routing + fallback.
export async function callWithFallback({
  settings,
  messages,
  task = "chat",
  signal,
  onChunk,
  options = {},
  preferConnection = null,
} = {}) {
  const excluded = [];
  let lastErr = null;
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const connection =
      attempt === 0 && preferConnection
        ? preferConnection
        : selectConnection({ settings, task, excludeIds: excluded });

    if (!connection) {
      if (lastErr) throw lastErr;
      throw new Error("No enabled API connection for task: " + task);
    }

    try {
      const result = await callModel({ connection, messages, signal, onChunk, options });
      return { ...result, connection };
    } catch (err) {
      lastErr = err;
      excluded.push(connection.id);
      // If user explicitly aborted, do not retry.
      if (err.name === "AbortError" || signal?.aborted) throw err;
      // Give up if there are no more candidates.
      const remaining = rankConnections({ settings, task, excludeIds: excluded });
      if (!remaining.length) break;
    }
  }

  throw lastErr || new Error("All model connections failed");
}

// Helper used by agent-loop.js and any single-turn callers.
export async function callConnection(settings, connection, messages, options = {}) {
  return callModel({ connection, messages, options });
}
