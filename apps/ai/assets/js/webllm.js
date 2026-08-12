// webllm.js — Offline browser-based LLM inference via wllama (WASM llama.cpp).
// Downloads GGUF models, caches them in IndexedDB, and runs inference locally.
// No server, no API key, no WebGPU required — works in all modern browsers.

// ── Model registry ────────────────────────────────────────────────────────────
// Curated list of small GGUF models suitable for in-browser inference.
// Updated list can be fetched from a remote URL at runtime.

// Tier order for auto-selection (lowest index = most resource-friendly)
export const TIER_ORDER = ["tiny", "small", "medium", "standard", "large"];

// Hardware requirements per tier (for auto-detection)
const TIER_HARDWARE = {
  tiny: { minMemoryGB: 0, webgpu: false, label: "Any device" },
  small: { minMemoryGB: 4, webgpu: false, label: "4 GB+ RAM" },
  medium: { minMemoryGB: 6, webgpu: false, label: "6 GB+ RAM" },
  standard: { minMemoryGB: 8, webgpu: false, label: "8 GB+ RAM" },
  large: { minMemoryGB: 12, webgpu: true, label: "12 GB+ RAM, WebGPU" },
};

export const DEFAULT_MODEL_REGISTRY = [
  {
    id: "qwen2.5-0.5b",
    name: "Qwen2.5 0.5B",
    sizeMB: 491,
    params: "0.5B",
    ctx: 32768,
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    description: "Lightweight general chat with long context",
    tier: "small",
    defaultModel: "qwen2.5-0.5b-instruct",
    hardware: { minMemoryGB: 4, webgpu: false },
  },
  {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B",
    sizeMB: 808,
    params: "1B",
    ctx: 8192,
    url: "https://huggingface.co/hugging-quants/Llama-3.2-1B-Instruct-Q4_K_M-GGUF/resolve/main/llama-3.2-1b-instruct-q4_k_m.gguf",
    description: "Strong instruction following, Meta's latest small model",
    tier: "medium",
    defaultModel: "llama-3.2-1b-instruct",
    hardware: { minMemoryGB: 6, webgpu: false },
  },
  {
    id: "gemma-3-1b",
    name: "Gemma 3 1B",
    sizeMB: 700,
    params: "1B",
    ctx: 32768,
    url: "https://huggingface.co/google/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-q4_k_m.gguf",
    description: "Good all-rounder from Google",
    tier: "medium",
    defaultModel: "gemma-3-1b-it",
    hardware: { minMemoryGB: 6, webgpu: false },
  },
  {
    id: "qwen2.5-1.5b",
    name: "Qwen2.5 1.5B",
    sizeMB: 1120,
    params: "1.5B",
    ctx: 32768,
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    description: "Excellent reasoning for its size",
    tier: "standard",
    defaultModel: "qwen2.5-1.5b-instruct",
    hardware: { minMemoryGB: 8, webgpu: false },
  },
  {
    id: "deepseek-r1-1.5b",
    name: "DeepSeek R1 Distill 1.5B",
    sizeMB: 1120,
    params: "1.5B",
    ctx: 32768,
    url: "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
    description: "Reasoning-focused, chain-of-thought",
    tier: "standard",
    defaultModel: "deepseek-r1-distill-qwen-1.5b",
    hardware: { minMemoryGB: 8, webgpu: false },
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    sizeMB: 2020,
    params: "3B",
    ctx: 8192,
    url: "https://huggingface.co/hugging-quants/Llama-3.2-3B-Instruct-Q4_K_M-GGUF/resolve/main/llama-3.2-3b-instruct-q4_k_m.gguf",
    description: "Best speed/quality tradeoff in the catalog",
    tier: "large",
    defaultModel: "llama-3.2-3b-instruct",
    hardware: { minMemoryGB: 12, webgpu: false },
  },
  {
    id: "phi-3.5-mini",
    name: "Phi-3.5 Mini 3.8B",
    sizeMB: 2390,
    params: "3.8B",
    ctx: 131072,
    url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    description: "Massive 128K context, Microsoft's best small model",
    tier: "large",
    defaultModel: "phi-3.5-mini-instruct",
    hardware: { minMemoryGB: 12, webgpu: true },
  },
];

const REMOTE_REGISTRY_URL = "/apps/ai/models.json";

// ── IndexedDB for model blob storage ─────────────────────────────────────────

const DB_NAME = "chatai-models";
const DB_VERSION = 1;
const STORE_NAME = "model-blobs";

function openModelDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getModelBlob(modelId) {
  const db = await openModelDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(modelId);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

async function putModelBlob(modelId, blob) {
  const db = await openModelDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put({ id: modelId, blob, storedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteModelBlob(modelId) {
  const db = await openModelDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(modelId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Installed model tracking (localStorage) ──────────────────────────────────

const INSTALLED_KEY = "chatai:installed_models";

export function getInstalledModels() {
  try {
    return JSON.parse(localStorage.getItem(INSTALLED_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getInstalledModelIds() {
  return Object.keys(getInstalledModels());
}

export function isModelInstalled(modelId) {
  return !!getInstalledModels()[modelId];
}

function saveInstalledModels(map) {
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(map));
  } catch {}
}

// ── Model registry fetching ──────────────────────────────────────────────────

export async function fetchModelRegistry() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(REMOTE_REGISTRY_URL, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const remote = await resp.json();
      if (remote && Array.isArray(remote.models) && remote.models.length) {
        // Merge remote models with defaults: remote overrides by id
        const merged = [...DEFAULT_MODEL_REGISTRY];
        for (const rm of remote.models) {
          const idx = merged.findIndex((m) => m.id === rm.id);
          if (idx >= 0) merged[idx] = { ...merged[idx], ...rm };
          else merged.push(rm);
        }
        return merged;
      }
    }
  } catch {}
  return DEFAULT_MODEL_REGISTRY;
}

// ── Storage quota check ────────────────────────────────────────────────────

export async function checkStorageQuota(requiredBytes) {
  if (!navigator.storage || !navigator.storage.estimate) return;
  const estimate = await navigator.storage.estimate();
  const available = estimate.quota - estimate.usage;
  if (available < requiredBytes) {
    const needed = formatBytes(requiredBytes);
    const have = formatBytes(available);
    throw new Error(
      `Not enough storage: need ${needed}, only ${have} available. Free up space and try again.`
    );
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Download queue (sequential) ─────────────────────────────────────────────

const downloadQueue = [];
let isDownloading = false;

export function enqueueDownload(modelId, modelUrl, onProgress) {
  return new Promise((resolve, reject) => {
    downloadQueue.push({ modelId, modelUrl, onProgress, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;
  const item = downloadQueue.shift();
  try {
    const blob = await downloadModel(item.modelId, item.modelUrl, item.onProgress);
    item.resolve(blob);
  } catch (e) {
    item.reject(e);
  } finally {
    isDownloading = false;
    processQueue();
  }
}

// ── Download model with progress ────────────────────────────────────────────

export async function downloadModel(modelId, modelUrl, onProgress) {
  // Estimate size from model registry for quota check
  const modelInfo = DEFAULT_MODEL_REGISTRY.find((m) => m.id === modelId);
  const estimatedBytes = modelInfo ? modelInfo.sizeMB * 1024 * 1024 : 0;
  if (estimatedBytes > 0) {
    await checkStorageQuota(estimatedBytes);
  }

  const resp = await fetch(modelUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const total = parseInt(resp.headers.get("content-length") || "0", 10);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  const startTime = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    // Compute speed and ETA
    const elapsed = (Date.now() - startTime) / 1000;
    let speed = 0, eta = 0;
    if (elapsed >= 0.5) {
      speed = received / elapsed;
      if (total > 0) eta = (total - received) / speed;
    }
    onProgress?.({ received, total, speed, eta });
  }
  // Store as a Blob in IndexedDB
  const blob = new Blob(chunks);
  await putModelBlob(modelId, blob);
  // Track metadata in localStorage
  const installed = getInstalledModels();
  installed[modelId] = {
    id: modelId,
    downloadedAt: Date.now(),
    size: total,
  };
  saveInstalledModels(installed);
  return blob;
}

export async function removeInstalledModel(modelId) {
  // Remove from IndexedDB
  await deleteModelBlob(modelId);
  // Remove from localStorage tracking
  const installed = getInstalledModels();
  delete installed[modelId];
  saveInstalledModels(installed);
  // Unload if currently loaded
  if (wllamaInstance && wllamaInstance.isModelLoaded()) {
    try {
      wllamaInstance.exit();
    } catch {}
    wllamaInstance = null;
  }
  loadedModelId = null;
}

// ── Model lookup helpers ────────────────────────────────────────────────────

export function getModelById(id) {
  return DEFAULT_MODEL_REGISTRY.find((m) => m.id === id) || null;
}

export function getTierHardware(tier) {
  return TIER_HARDWARE[tier] || TIER_HARDWARE.tiny;
}

// ── Hardware detection ──────────────────────────────────────────────────────

export async function detectHardware() {
  const info = {
    deviceMemory: navigator.deviceMemory || 4,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    webgpu: false,
    webgpuName: "",
  };
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        info.webgpu = true;
        info.webgpuName = adapter.name || "WebGPU adapter";
      }
    }
  } catch {}
  return info;
}

export function recommendTier(hw) {
  const mem = hw.deviceMemory;
  if (mem >= 12 && hw.webgpu) return "large";
  if (mem >= 8) return "standard";
  if (mem >= 6) return "medium";
  if (mem >= 4) return "small";
  return "tiny";
}

// ── Wllama singleton ────────────────────────────────────────────────────────

let wllamaInstance = null;
let loadedModelId = null;

export async function unloadModel() {
  if (wllamaInstance) {
    try {
      wllamaInstance.exit();
    } catch {}
    wllamaInstance = null;
  }
  loadedModelId = null;
}

async function getWllama() {
  if (!wllamaInstance) {
    const { Wllama } = await import(
      "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/index.js"
    );
    wllamaInstance = new Wllama({
      // wllama will auto-detect WASM path from the CDN
    });
  }
  return wllamaInstance;
}

// ── Token estimation ────────────────────────────────────────────────────────

function estimateTokenCount(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const charEstimate = Math.ceil(text.length / 4);
  return Math.max(Math.round(words * 1.3), charEstimate);
}

// ── Run inference locally ────────────────────────────────────────────────────

export async function callWebLLM({
  connection,
  messages,
  signal,
  onChunk,
  options = {},
} = {}) {
  const modelId = connection.modelId || "qwen2.5-0.5b";
  const registry = await fetchModelRegistry();
  // Backward compatibility: map old model IDs to new ones
  const OLD_ID_MAP = { "qwen2-0.5b": "qwen2.5-0.5b" };
  const resolvedId = OLD_ID_MAP[modelId] || modelId;
  const modelInfo =
    registry.find((m) => m.id === resolvedId) || DEFAULT_MODEL_REGISTRY[0];

  let wllama = await getWllama();

  // Load model if not already loaded or if a different model is needed
  if (!wllama.isModelLoaded() || loadedModelId !== modelId) {
    // Unload previous model if switching
    if (loadedModelId && loadedModelId !== modelId) {
      await unloadModel();
    }
    // Re-acquire wllama instance (may have been destroyed by unloadModel)
    wllama = await getWllama();
    // Try loading from IndexedDB cache first
    const cachedBlob = await getModelBlob(modelId);
    if (cachedBlob) {
      await wllama.loadModel([cachedBlob], {
        n_ctx: modelInfo.ctx || 4096,
        n_threads: navigator.hardwareConcurrency || 4,
      });
    } else {
      // Not cached — download and load from URL (wllama handles HTTP cache)
      await wllama.loadModelFromUrl(modelInfo.url, {
        n_ctx: modelInfo.ctx || 4096,
        n_threads: navigator.hardwareConcurrency || 4,
      });
    }
    loadedModelId = modelId;
  }

  // Build messages array for wllama's createChatCompletion
  // wllama accepts OpenAI-compatible messages: { role, content }
  const chatMessages = messages.map((m) => ({
    role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  // Use streaming
  const stream = wllama.createChatCompletion({
    messages: chatMessages,
    max_tokens: options.maxTokens || 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    top_k: options.topK ?? 40,
    stream: true,
    abortSignal: signal,
  });

  let content = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";
    if (delta) {
      content += delta;
      onChunk?.(delta, content);
    }
    if (signal?.aborted) break;
  }

  // Estimate token count from output length (wllama doesn't report it)
  const estimatedTokens = estimateTokenCount(content);
  return {
    content,
    usage: { total_tokens: estimatedTokens },
    streamed: true,
  };
}
