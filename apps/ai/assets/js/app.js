// app.js — offline-first ChatAI PWA.
// All chats, settings, and keys live in the browser (IndexedDB + localStorage).
// AI requests go directly from the browser to the configured API endpoint.
// No backend, no analytics, no accounts.

import {
  CONNECTION_TYPES,
  CONNECTION_TYPE_ORDER,
  DEFAULT_AGENTS,
  DEFAULT_AGENT_IDS,
  PROVIDERS,
  PROVIDER_ORDER,
  typeById,
} from "./providers.js";
import {
  callModel,
  callWithFallback,
  selectConnection,
} from "./model-router.js";
import { openDB, CONVERSATIONS_STORE as STORE } from "./db.js";
import { generateImage, searchWeb } from "./tools.js";
import { extractTextFromFile, getDocumentExtension } from "./doc-parser.js";
import { addFileToKnowledgeBase, removeFileFromKnowledgeBase, getKnowledgeBaseFiles, embedQuery, searchKnowledgeBase, formatKBContext, kbClear } from "./rag.js";
import { getMemoryContext, rememberFromMessage } from "./memory.js";
import {
  fetchModelRegistry,
  getInstalledModels,
  getInstalledModelIds,
  isModelInstalled,
  downloadModel,
  enqueueDownload,
  removeInstalledModel,
  unloadModel,
  DEFAULT_MODEL_REGISTRY,
  detectHardware,
  recommendTier,
} from "./webllm.js";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  createSpeechRecognizer,
  transcribeAudio,
  speakText,
  stopSpeaking,
} from "./voice.js";

/* ---------- Storage layer (IndexedDB) ---------- */

async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(conv) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(conv);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Settings (localStorage) ---------- */
const SETTINGS_KEY = "chatai:settings:v3";
const OLD_SETTINGS_KEY = "chatai:settings:v2";
const OLDER_SETTINGS_KEY = "chatai:settings:v1";

function uid() {
  return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function migrateOldConnections(old) {
  const connections = [];
  const keys = old?.keys || {};
  const endpoints = old?.endpoints || {};
  const models = old?.models || {};
  const enabled = old?.enabled || {};
  const map = {
    local: "ollama",
    glm: "zhipu",
    kimi: "moonshot",
    minimax: "minimax",
    nemotron: "nvidia",
    gemma: "gemini",
    qwen: "qwen",
  };
  for (const pid of PROVIDER_ORDER) {
    const on = enabled[pid] !== false;
    const t = typeById(map[pid]);
    if (!t) continue;
    connections.push({
      id: uid(),
      type: t.id,
      label: t.label,
      endpoint: endpoints[pid] || t.defaultEndpoint,
      model: models[pid] || t.defaultModel,
      key: keys[pid] || "",
      enabled: on,
    });
  }
  return connections;
}

function loadSettings() {
  try {
    let raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const v2raw = localStorage.getItem(OLD_SETTINGS_KEY);
      if (v2raw) {
        const v2 = JSON.parse(v2raw);
        const migrated = {
          activeConnectionId: v2?.activeConnectionId || "auto",
          activeAgentId: "auto",
          connections: Array.isArray(v2?.connections) ? v2.connections : [],
          agents: mergeAgents(v2?.agents || []),
          onlineMode: true,
          creditBudget: 0,
        };
        // Preserve any old system prompt as a custom agent so the user keeps it.
        if (v2?.systemPrompt?.trim()) {
          migrated.agents.push({
            id: uid(),
            label: "Migrated system prompt",
            prompt: v2.systemPrompt.trim(),
            enabled: true,
            autoTags: ["chat", "general"],
          });
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
        return migrated;
      }
      const v1raw = localStorage.getItem(OLDER_SETTINGS_KEY);
      if (v1raw) {
        const v1 = JSON.parse(v1raw);
        const migrated = {
          activeConnectionId: "auto",
          activeAgentId: "auto",
          connections: migrateOldConnections(v1),
          agents: mergeAgents(v1?.agents || []),
          onlineMode: true,
          creditBudget: 0,
        };
        if (v1?.systemPrompt?.trim()) {
          migrated.agents.push({
            id: uid(),
            label: "Migrated system prompt",
            prompt: v1.systemPrompt.trim(),
            enabled: true,
            autoTags: ["chat", "general"],
          });
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
    const s = raw ? JSON.parse(raw) : {};
    const agents = mergeAgents(s.agents);
    const settings = {
      activeConnectionId: s.activeConnectionId || "auto",
      activeAgentId: s.activeAgentId || "auto",
      connections: Array.isArray(s.connections) ? s.connections : [],
      agents,
      onlineMode: s.onlineMode !== false,
      creditBudget: Math.max(0, Number(s.creditBudget) || 0),
      // RAG
      ragEnabled: s.ragEnabled !== false,
      ragEmbeddingProvider: s.ragEmbeddingProvider || "",
      ragTopK: Math.max(1, Math.min(20, Number(s.ragTopK) || 5)),
      ragChunkSize: Math.max(100, Math.min(2000, Number(s.ragChunkSize) || 500)),
      ragChunkOverlap: Math.max(0, Math.min(500, Number(s.ragChunkOverlap) || 100)),
      // Voice
      ttsProvider: s.ttsProvider || "web-speech",
      ttsLang: s.ttsLang || "",
      ttsRate: Math.max(0.5, Math.min(2, Number(s.ttsRate) || 1)),
      ttsPitch: Math.max(0.5, Math.min(2, Number(s.ttsPitch) || 1)),
      voiceInputProvider: s.voiceInputProvider || "web-speech",
    };
    return settings;
  } catch {
    return {
      activeConnectionId: "auto",
      activeAgentId: "auto",
      connections: [],
      agents: mergeAgents([]),
      onlineMode: true,
      creditBudget: 0,
      ragEnabled: false,
      ragEmbeddingProvider: "",
      ragTopK: 5,
      ragChunkSize: 500,
      ragChunkOverlap: 100,
      ttsProvider: "web-speech",
      ttsLang: "",
      ttsRate: 1,
      ttsPitch: 1,
      voiceInputProvider: "web-speech",
    };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

const SESSION_USAGE_KEY = "chatai:sessionUsage:v1";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadSessionUsage() {
  try {
    const raw = localStorage.getItem(SESSION_USAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s?.date === todayStr()) return Math.max(0, Number(s.tokens) || 0);
    }
  } catch {}
  return 0;
}

function saveSessionUsage(tokens) {
  try {
    localStorage.setItem(SESSION_USAGE_KEY, JSON.stringify({ tokens: Math.max(0, tokens), date: todayStr() }));
  } catch {}
}

function addSessionUsage(tokens) {
  const total = loadSessionUsage() + Math.max(0, tokens);
  saveSessionUsage(total);
  return total;
}

function enabledConnections(s) {
  return (s.connections || []).filter((c) => c.enabled !== false);
}

function chatConnections(s) {
  return enabledConnections(s).filter((c) => {
    const t = typeById(c.type);
    return !t?.isAudio && !t?.isImage && !t?.isSearch && !t?.isEmbedding;
  });
}

// Merge saved agents with the canonical default agents. Default agents are always
// restored with their original prompts; only their enabled state is preserved.
// Custom agents (IDs not in DEFAULT_AGENT_IDS) are kept as-is.
function mergeAgents(savedAgents) {
  const custom = (savedAgents || []).filter((a) => a && !DEFAULT_AGENT_IDS.has(a.id));
  const defaults = DEFAULT_AGENTS.map((d) => ({ ...d }));
  for (const saved of savedAgents || []) {
    if (!saved) continue;
    const def = defaults.find((a) => a.id === saved.id);
    if (def && typeof saved.enabled === "boolean") def.enabled = saved.enabled;
  }
  return [...defaults, ...custom];
}

function enabledAgents(s) {
  return mergeAgents(s.agents).filter((a) => a.enabled !== false);
}

function connectionById(s, id) {
  return (s.connections || []).find((c) => c.id === id) || null;
}

function agentById(s, id) {
  return mergeAgents(s.agents).find((a) => a.id === id) || null;
}

function activeConnection(s) {
  const enabled = chatConnections(s);
  if (!enabled.length) return null;
  if (s.activeConnectionId && s.activeConnectionId !== "auto") {
    const found = enabled.find((c) => c.id === s.activeConnectionId);
    if (found) return found;
  }
  return enabled[0];
}

function activeAgent(s) {
  const enabled = enabledAgents(s);
  if (!enabled.length) return null;
  if (s.activeAgentId && s.activeAgentId !== "auto") {
    const found = enabled.find((a) => a.id === s.activeAgentId);
    if (found) return found;
  }
  return enabled[0];
}

function pickConnectionForPrompt(s, prompt) {
  const task = inferTask(prompt, null);
  return selectConnection({ settings: s, task }) || chatConnections(s)[0] || null;
}

function pickAgentForPrompt(s, prompt) {
  const enabled = enabledAgents(s);
  if (!enabled.length) return null;
  // Image requests are routed by looksLikeImageRequest; pick the image agent
  // explicitly so meta/mode displays correctly when available.
  if (looksLikeImageRequest(prompt, null)) {
    const imageAgent = enabled.find((a) => a.id === "agent_image");
    if (imageAgent) return imageAgent;
  }
  const lower = (prompt || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const a of enabled) {
    if (!a.autoTags?.length) continue;
    let score = 0;
    for (const tag of a.autoTags) {
      if (lower.includes(tag.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best || enabled.find((a) => a.id === "agent_auto") || enabled[0];
}

/* ---------- State ---------- */
const state = {
  settings: loadSettings(),
  conversations: [],
  activeId: null,
  streaming: false,
  abortCtrl: null,
  lastAuto: { connectionId: null, agentId: null, promptHash: null },
  sessionTokens: loadSessionUsage(),
};

let pendingAttachments = [];
let voiceRecorder = null; // MediaRecorder instance
let voiceChunks = []; // blob chunks for Whisper fallback
let speechRecognizer = null; // Web Speech API recognizer
let modelRegistry = []; // populated from fetchModelRegistry()
const downloads = new Map(); // modelId -> { model, progress, status, error }

/* ---------- Sidebar resize ---------- */
const SIDEBAR_WIDTH_KEY = "chatai:sidebarWidth";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
let sidebarDidDrag = false; // set when a drag moves the handle, suppresses the toggle click

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const chatListEl = $("chat-list");
const inputEl = $("input");
const composerEl = $("composer");
const stopBtn = $("btn-stop");
const sendBtn = $("btn-send");
const attachBtn = $("btn-attach");
const voiceRecordingBar = $("voice-recording-bar");
const voiceRecordingText = $("voice-recording-text");
const stopVoiceBtn = $("btn-stop-voice");
const voiceBtn = $("btn-voice");
const fileInputEl = $("file-attach");
const attachmentPreviewEl = $("attachment-preview");
const netStatusEl = $("net-status");
const sidebarEl = $("sidebar");
const sidebarHandleEl = $("sidebar-handle");
const onlineBtnEl = $("btn-online");
const connectionSelectEl = $("connection-select");
const modelSelectEl = $("model-select");
const agentSelectEl = $("agent-select");
const exportChatBtn = $("btn-export-chat");

// Offline models
const addModelDialog = $("add-model-dialog");
const offlineModelList = $("offline-model-list");

// Download status (sidebar)
const downloadStatusEl = $("download-status");
const downloadListEl = $("download-list");

/* ---------- Utils ---------- */
function nowTs() { return Date.now(); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function titleFrom(msg) {
  const text = extractText(msg);
  const t = text.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, 48) : "New chat";
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text")
      .map((p) => p.text || "")
      .join("\n");
  }
  return "";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "";
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.round(seconds)}s`;
}

function formatConnectionCredit(connection) {
  const label = connection?.label || typeById(connection?.type)?.label || connection?.type || "Unknown AI";
  const model = connection?.model || "";
  const l = label.toLowerCase();
  const m = model.toLowerCase();
  if (model && l !== m && !l.endsWith(m)) return `${label} · ${model}`;
  return label;
}

function fileKind(type, name) {
  if (!type) return guessKindFromName(name);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/") || /\/(javascript|json|xml|csv|html|css|markdown|plain)/.test(type)) return "text";
  const ext = getDocumentExtension(name);
  if (["pdf", "docx", "doc"].includes(ext)) return "document";
  return "binary";
}

function guessKindFromName(name) {
  const ext = getDocumentExtension(name);
  if (["pdf", "docx", "doc"].includes(ext)) return "document";
  if (["txt", "md", "csv", "html", "htm", "json", "js", "css", "py", "sql", "xml"].includes(ext)) return "text";
  return "binary";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function readAttachment(file) {
  const kind = fileKind(file.type, file.name);
  let data = null;
  if (kind === "image") {
    data = await readFileAsDataURL(file);
  } else if (kind === "text") {
    data = await readFileAsText(file);
  } else if (kind === "document") {
    try {
      data = await extractTextFromFile(file);
    } catch (e) {
      console.error("Document extraction failed", file.name, e);
      data = `[Could not extract text: ${e.message || e}]`;
    }
  }
  return {
    id: "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    kind,
    data,
  };
}

function buildMessageContent(text, attachments) {
  if (!attachments?.length) return text || "";
  const textParts = [text || ""];
  const imageParts = [];
  for (const att of attachments) {
    if (att.kind === "image") {
      imageParts.push({ type: "image_url", image_url: { url: att.data, detail: "auto" } });
    } else if (att.kind === "text" || att.kind === "document") {
      const snippet = att.kind === "document" && att.data?.length > 12000
        ? att.data.slice(0, 12000) + "\n\n[...document truncated]"
        : att.data || "";
      textParts.push(`\n\n[File: ${att.name}]\n\`\`\`\n${snippet}\n\`\`\``);
    } else {
      textParts.push(`\n\n[File: ${att.name} (${att.type || "unknown"}, ${formatBytes(att.size)})]`);
    }
  }
  const fullText = textParts.join("");
  if (imageParts.length === 0) return fullText;
  const result = [];
  if (fullText) result.push({ type: "text", text: fullText });
  result.push(...imageParts);
  return result;
}

function activeConv() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function looksLikeImageRequest(text, agent) {
  if (agent?.id === "agent_image" || agent?.label?.toLowerCase().includes("image")) return true;
  const lower = (text || "").toLowerCase();
  const triggers = [
    "generate image", "generate a image", "generate an image", "generate me an image", "generate me a image",
    "create image", "create a image", "create an image", "create me an image", "create me a image",
    "draw", "draw a", "draw an", "draw me", "draw me a", "draw me an",
    "image of", "picture of", "photo of", "illustration of", "diagram of", "render an image", "render a image",
    "make an image", "make a image", "make me an image", "make me a image", "make picture", "make a picture", "make me a picture",
    "produce an image", "produce a image", "produce me an image", "design an image", "design a image", "design me an image",
    "give me an image", "give me a image", "show me an image", "show me a image", "show image of", "generate picture",
    "ai image", "image generation", "text to image", "text-to-image", "create artwork", "generate artwork", "draw artwork",
  ];
  return triggers.some((t) => lower.includes(t));
}

function looksLikeSearchRequest(text, agent) {
  if (agent?.id === "agent_web_researcher" || agent?.label?.toLowerCase().includes("web researcher")) return true;
  const lower = (text || "").toLowerCase();
  const triggers = ["search", "look up", "find online", "latest", "recent", "news", "current events", "what is the latest", "what are the latest"];
  return triggers.some((t) => lower.includes(t));
}

function looksLikeKBRequest(text, agent) {
  if (agent?.id === "agent_rag" || agent?.label?.toLowerCase().includes("knowledge base")) return true;
  const lower = (text || "").toLowerCase();
  const triggers = ["my document", "my pdf", "my notes", "my files", "knowledge base", "kb", "uploaded file", "from the document"];
  return triggers.some((t) => lower.includes(t));
}

function findEnabledConnection(typeIds) {
  return enabledConnections(state.settings).find((c) => c.enabled !== false && typeIds.includes(c.type));
}

function hasEnabledTTS() {
  const ttsTypes = ["openai_tts", "elevenlabs_tts"];
  return enabledConnections(state.settings).some((c) => ttsTypes.includes(c.type));
}

async function renderImageResult(conv, connection, imageUrl) {
  const result = {
    role: "assistant",
    content: `![Generated image](${imageUrl})\n\n*Generated with ${formatConnectionCredit(connection)}*`,
    usage: null,
    connection: { id: connection.id, type: connection.type, label: connection.label || typeById(connection.type)?.label || connection.type, model: connection.model },
    agent: { id: "agent_image", label: "Image creator" },
    ts: nowTs(),
  };
  conv.messages.push(result);
  appendMessageEl(result);
  await persistConv(conv);
}

function renderSearchContext(searchResults) {
  if (!searchResults?.length) return "";
  const lines = ["Web search results:"];
  searchResults.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`);
  });
  return lines.join("\n\n");
}

/* ---------- Render ---------- */
function renderChatList() {
  const q = ($("search").value || "").trim().toLowerCase();
  chatListEl.innerHTML = "";
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of sorted) {
    if (q && !c.title.toLowerCase().includes(q)) continue;
    const item = document.createElement("div");
    item.className = "chat-item" + (c.id === state.activeId ? " active" : "");
    item.dataset.id = c.id;
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = c.title || "New chat";
    title.ondblclick = (e) => { e.preventDefault(); e.stopPropagation(); startRename(c.id, title); };
    const chatCredits = c.messages?.reduce((sum, m) => sum + (m.usage?.total_tokens || 0), 0) || 0;
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Delete conversation";
    del.textContent = "×";
    del.onclick = (e) => { e.stopPropagation(); deleteConv(c.id); };
    item.append(title, del);
    if (chatCredits > 0) {
      const tokens = document.createElement("span");
      tokens.className = "tokens";
      tokens.textContent = `⚡ ${chatCredits.toLocaleString()}`;
      tokens.title = `${chatCredits.toLocaleString()} tokens used in this chat`;
      item.insertBefore(tokens, del);
    }
    item.onclick = () => { setActive(c.id); closeSidebarMobile(); };
    chatListEl.appendChild(item);
  }
  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "No conversations yet. Start typing to begin.";
    chatListEl.appendChild(empty);
  }
}

function startRename(id, titleEl) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  const input = document.createElement("input");
  input.type = "text";
  input.value = conv.title;
  input.className = "chat-rename";
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = async () => {
    const val = input.value.trim();
    if (val && val !== conv.title) {
      conv.title = val;
      conv.updatedAt = nowTs();
      await dbPut(conv);
    }
    renderChatList();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(); }
    else if (e.key === "Escape") { renderChatList(); }
  });
  input.addEventListener("blur", finish);
  input.addEventListener("click", (e) => e.stopPropagation());
}

function renderMessages() {
  const conv = activeConv();
  messagesEl.innerHTML = "";
  if (!conv || conv.messages.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.innerHTML = "Send a message to start a conversation.<br>Your history is stored only in this browser.";
    messagesEl.appendChild(hint);
    return;
  }
  for (const m of conv.messages) {
    if (!m.hidden) appendMessageEl(m);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderAttachmentChip(att, removable = true) {
  const chip = document.createElement("div");
  chip.className = "attachment-chip";
  chip.dataset.id = att.id;

  if (att.kind === "image" && att.data) {
    const img = document.createElement("img");
    img.src = att.data;
    img.alt = att.name;
    chip.appendChild(img);
  } else {
    const ext = att.name.split(".").pop()?.toUpperCase?.() || "FILE";
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = ext.slice(0, 4);
    chip.appendChild(icon);
    if (att.kind === "document" && att.data) {
      const extracted = document.createElement("span");
      extracted.className = "extracted-badge";
      extracted.textContent = "text extracted";
      chip.appendChild(extracted);
    }
  }

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = att.name;
  name.title = att.name;
  chip.appendChild(name);

  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = formatBytes(att.size);
  chip.appendChild(size);

  if (removable) {
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.title = "Remove attachment";
    remove.setAttribute("aria-label", "Remove attachment");
    remove.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`;
    remove.onclick = () => {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
      renderAttachmentPreview();
    };
    chip.appendChild(remove);
  }

  return chip;
}

function renderAttachmentPreview() {
  if (!attachmentPreviewEl) return;
  attachmentPreviewEl.innerHTML = "";
  const hasAttachments = pendingAttachments.length > 0;
  if (!hasAttachments) {
    attachmentPreviewEl.hidden = true;
    return;
  }
  attachmentPreviewEl.hidden = false;
  for (const att of pendingAttachments) {
    attachmentPreviewEl.appendChild(renderAttachmentChip(att, true));
  }
}

async function onFileSelect(e) {
  const files = e.target.files;
  if (!files?.length) return;
  await addAttachments(Array.from(files));
  e.target.value = "";
  inputEl.focus();
}

async function addAttachments(files) {
  for (const file of files) {
    try {
      pendingAttachments.push(await readAttachment(file));
    } catch (err) {
      console.error("Failed to read attachment", file.name, err);
      alert(`Could not read ${file.name}`);
    }
  }
  renderAttachmentPreview();
}

function onPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  addAttachments(files);
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachmentPreview();
}

function appendMessageEl(m) {
  const el = document.createElement("div");
  el.className = "msg " + (m.role === "user" ? "user" : m.role === "system" ? "system" : m.role === "error" ? "error" : "assistant");
  if (m.role === "assistant" || m.role === "error") {
    el.innerHTML = renderContent(m.content);
    const meta = document.createElement("span");
    meta.className = "meta";
    const metaParts = [];
    if (m.connection) {
      metaParts.push(formatConnectionCredit(m.connection));
      if (m.agent?.label) metaParts.push(m.agent.label);
    } else if (m.role === "assistant") {
      metaParts.push("Unknown AI");
    }
    if (m.usage?.total_tokens) {
      metaParts.push(`${m.usage.total_tokens.toLocaleString()} tokens`);
    }
    meta.textContent = metaParts.join(" · ");
    el.appendChild(meta);

    if (m.role === "assistant" && m.searchResults?.length) {
      const chips = document.createElement("div");
      chips.className = "search-citations";
      for (const r of m.searchResults) {
        const a = document.createElement("a");
        a.className = "search-chip";
        try {
          const safeUrl = new URL(r.url);
          a.href = safeUrl.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        } catch {
          a.removeAttribute("href");
          a.style.cursor = "default";
        }
        a.title = `${r.title}\n${r.url}`;
        a.textContent = r.title || r.url;
        chips.appendChild(a);
      }
      el.appendChild(chips);
    }

    if (m.role === "assistant" && m.kbSources?.length) {
      const chips = document.createElement("div");
      chips.className = "search-citations";
      const seen = new Set();
      for (const src of m.kbSources) {
        if (seen.has(src)) continue;
        seen.add(src);
        const span = document.createElement("span");
        span.className = "search-chip";
        span.textContent = `📄 ${src}`;
        span.style.cursor = "default";
        chips.appendChild(span);
      }
      el.appendChild(chips);
    }

    // TTS play button for assistant messages.
    if (m.role === "assistant" && (isSpeechSynthesisSupported() || hasEnabledTTS())) {
      const speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.className = "icon-btn speak-btn";
      speakBtn.title = "Read aloud";
      speakBtn.setAttribute("aria-label", "Read aloud");
      speakBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
      speakBtn.addEventListener("click", () => {
        const text = extractText(m.content);
        if (!text) return;
        speakBtn.classList.add("speaking");
        const signal = new AbortController().signal;
        speakText(text, state.settings, state.settings.connections || [], signal)
          .then(() => speakBtn.classList.remove("speaking"))
          .catch((err) => {
            console.error("tts failed", err);
            speakBtn.classList.remove("speaking");
          });
      });
      el.appendChild(speakBtn);
    }

  } else {
    const text = extractText(m.content);
    if (text) {
      const textEl = document.createElement("div");
      textEl.textContent = text;
      el.appendChild(textEl);
    }
    if (m.attachments?.length) {
      const attWrap = document.createElement("div");
      attWrap.className = "attachment-render";
      attWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;";
      for (const att of m.attachments) {
        const chip = renderAttachmentChip(att, false);
        chip.className = "attachment-chip";
        attWrap.appendChild(chip);
      }
      el.appendChild(attWrap);
    }
  }
  if (m.id) el.dataset.id = m.id;
  messagesEl.appendChild(el);
  return el;
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return html;
}

function renderImageMarkdown(text) {
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="generated-image" loading="lazy" />`;
  });
}

function renderTableBlock(lines) {
  const rows = lines.map((line) => {
    let inner = line.trim();
    if (inner.startsWith("|")) inner = inner.slice(1);
    if (inner.endsWith("|")) inner = inner.slice(0, -1);
    return inner.split("|").map((c) => c.trim());
  });

  let header = null;
  let body = rows;
  if (rows.length >= 2 && rows[1].every((cell) => /^[:\-]+$/.test(cell) && cell.includes("-"))) {
    header = rows[0];
    body = rows.slice(2);
  }

  const cell = (content, tag) => "<" + tag + ">" + renderInline(content) + "</" + tag + ">";
  let html = '<table class="md-table">';
  if (header) {
    html += "<thead><tr>" + header.map((c) => cell(c, "th")).join("") + "</tr></thead>";
  }
  html += "<tbody>" + body.map((row) => "<tr>" + row.map((c) => cell(c, "td")).join("") + "</tr>").join("") + "</tbody></table>";
  return html;
}

function renderContent(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes("|")) {
      let j = i;
      while (j < lines.length && lines[j].includes("|")) j++;
      const block = lines.slice(i, j);
      const pipeCounts = block.map((l) => l.split("|").length - 1);
      const hasSeparator = block.some((l) => {
        const cells = l.split("|").map((c) => c.trim()).filter(Boolean);
        return cells.length > 1 && cells.every((c) => /^:?-+:?$/.test(c) && c.includes("-"));
      });
      if (pipeCounts.every((n) => n > 0) && hasSeparator) {
        out.push(renderTableBlock(block));
        i = j;
        continue;
      }
    }
    out.push(escapeHtml(line));
    i++;
  }

  let html = out.join("\n");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Markdown images (e.g. generated images)
  html = renderImageMarkdown(html);

  // Markdown links: render as non-clickable text so sources never navigate away.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
    return `<span class="md-link" title="${u}">${t}</span>`;
  });

  // Bullet lists (lines starting with * or -)
  html = html.replace(/^([\*\-])\s+(.+)$/gm, "<li>$2</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, (m) => '<ul class="md-list">' + m + "</ul>");

  // Numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, (m) => {
    if (m.includes("<ul")) return m;
    return '<ol class="md-list">' + m + "</ol>";
  });

  // Headings
  html = html.replace(/^###\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^##\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^#\s+(.+)$/gm, "<h2>$1</h2>");

  return html.replace(/\n/g, "<br>");
}

/* ---------- Conversations ---------- */
async function newConv() {
  const conv = { id: uid(), title: "New chat", createdAt: nowTs(), updatedAt: nowTs(), messages: [] };
  state.conversations.push(conv);
  state.activeId = conv.id;
  await dbPut(conv);
  renderChatList();
  renderMessages();
  inputEl.focus();
}

async function setActive(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  clearAttachments();
  renderChatList();
  renderMessages();
}

async function deleteConv(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) state.activeId = state.conversations[0]?.id || null;
  await dbDelete(id);
  renderChatList();
  renderMessages();
}

async function ensureConv() {
  if (activeConv()) return activeConv();
  await newConv();
  return activeConv();
}

async function persistConv(conv) {
  conv.updatedAt = nowTs();
  await dbPut(conv);
  renderChatList();
}

/* ---------- Composer selectors ---------- */
function renderConnectionSelect() {
  const sel = connectionSelectEl;
  const enabled = chatConnections(state.settings);
  sel.innerHTML = "";

  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "Auto connection";
  sel.appendChild(autoOpt);

  const current = state.settings.activeConnectionId || "auto";
  if (enabled.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No connection — add in Settings";
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  } else if (current === "auto" || enabled.some((c) => c.id === current)) {
    autoOpt.selected = current === "auto";
  }

  // Sort into groups: offline (browser) first, then local servers, then API.
  const offline = enabled.filter((c) => c.type === "webllm");
  const local = enabled.filter((c) => c.type === "ollama" || c.type === "llamacpp");
  const api = enabled.filter((c) => c.type !== "webllm" && c.type !== "ollama" && c.type !== "llamacpp");

  const addGroup = (label, conns, labelFn, color) => {
    if (!conns.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const c of conns) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = labelFn(c);
      if (color) o.style.color = color;
      if (c.id === current) o.selected = true;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };

  // Offline first — short label (model name + "· Private"), green.
  addGroup("Offline (browser) — private", offline, (c) => `${c.label} · Private`, "var(--color-success)");
  // If none installed, offer the install entry so offline setup stays discoverable.
  if (offline.length === 0) {
    const o = document.createElement("option");
    o.value = "__install_offline__";
    o.textContent = "＋ Install offline model…";
    sel.appendChild(o);
  }
  // Then local servers (Ollama, llama.cpp).
  addGroup("Local server", local, (c) => formatConnectionCredit(c));
  // Then API models.
  addGroup("API models", api, (c) => formatConnectionCredit(c));
  renderModelSelect();
}

function renderAgentSelect() {
  const sel = agentSelectEl;
  const enabled = enabledAgents(state.settings);
  sel.innerHTML = "";

  const hasAutoAgent = enabled.some((a) => a.id === "agent_auto");

  // Only add the system-level "auto" option when there is no Auto agent preset,
  // so the dropdown never shows "Auto agent" twice.
  let autoOpt = null;
  if (!hasAutoAgent) {
    autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto agent";
    sel.appendChild(autoOpt);
  }

  if (enabled.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No agent";
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
    return;
  }

  let current = state.settings.activeAgentId || "auto";
  if (current === "auto" && hasAutoAgent) current = "agent_auto";

  if (!enabled.some((a) => a.id === current)) {
    current = enabled.some((a) => a.id === "agent_auto") ? "agent_auto" : (enabled[0]?.id || "auto");
    if (state.settings.activeAgentId !== current) {
      state.settings.activeAgentId = current;
      saveSettings(state.settings);
    }
  }

  if (autoOpt && (current === "auto" || !enabled.some((a) => a.id === current))) {
    autoOpt.selected = true;
  }

  for (const a of enabled) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.label || "Agent";
    if (a.id === current) o.selected = true;
    sel.appendChild(o);
  }
}

function onConnectionSelectChange() {
  const id = connectionSelectEl.value;
  if (id === "__install_offline__") {
    openAddModelDialog("offline");
    renderConnectionSelect(); // restore the previous selection
    return;
  }
  if (!id) return;
  state.settings.activeConnectionId = id;
  saveSettings(state.settings);
  renderModelSelect();
}

/* ---------- Ollama model dropdown ---------- */
// Cache of fetched Ollama model lists, keyed by base URL, so the dropdown
// doesn't re-fetch on every re-render (e.g. after picking a model).
const ollamaModelsCache = new Map();
// Monotonic token so a slow fetch for a previously-selected connection can't
// overwrite the dropdown for the currently-selected one.
let modelSelectToken = 0;

// Derive the Ollama base URL from a chat-completions endpoint
// (http://host:port/v1/chat/completions -> http://host:port). Returns null
// when the endpoint isn't a parseable URL.
function ollamaBaseUrl(endpoint) {
  try {
    const u = new URL(endpoint);
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Fetch installed models from the Ollama native API (GET /api/tags).
async function fetchOllamaModels(endpoint) {
  const base = ollamaBaseUrl(endpoint);
  if (!base) throw new Error("Invalid Ollama endpoint");
  // Manual AbortController + timer instead of AbortSignal.timeout() so the
  // fetch still times out on browsers that don't support AbortSignal.timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Ollama API ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the currently-loaded model(s) from the Ollama native API (GET /api/ps).
// First entry = most recently used loaded model. Same timeout pattern as
// fetchOllamaModels.
async function fetchOllamaLoadedModel(endpoint) {
  const base = ollamaBaseUrl(endpoint);
  if (!base) throw new Error("Invalid Ollama endpoint");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/api/ps`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Ollama API ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

// Show/hide the composer model dropdown and populate it with the active
// connection's installed Ollama models. Hidden for non-Ollama connections.
async function renderModelSelect() {
  const sel = modelSelectEl;
  const refreshBtn = $("btn-refresh-model-select");
  const conn = activeConnection(state.settings);
  const token = ++modelSelectToken;
  if (!conn || conn.type !== "ollama") {
    sel.hidden = true;
    if (refreshBtn) refreshBtn.hidden = true;
    sel.innerHTML = "";
    return;
  }
  sel.hidden = false;
  if (refreshBtn) refreshBtn.hidden = false;
  sel.innerHTML = "";

  const current = conn.model || "";
  const base = ollamaBaseUrl(conn.endpoint);
  let models = base ? ollamaModelsCache.get(base) : null;
  let loadError = null;

  if (!models) {
    const loading = document.createElement("option");
    loading.value = "";
    loading.textContent = "Loading models…";
    loading.disabled = true;
    sel.appendChild(loading);
    try {
      models = await fetchOllamaModels(conn.endpoint);
      if (base) ollamaModelsCache.set(base, models);
    } catch (e) {
      loadError = e;
      models = null;
    }
    if (token !== modelSelectToken) return; // a newer selection superseded this one
  }

  sel.innerHTML = "";
  if (loadError) {
    // Surface the failure instead of silently showing a bare fallback.
    console.warn("Failed to load Ollama models", loadError);
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "⚠ Couldn't load models — check Ollama is running and OLLAMA_ORIGINS allows this site";
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    if (current) {
      const keep = document.createElement("option");
      keep.value = current;
      keep.textContent = `${current} (configured)`;
      sel.appendChild(keep);
    }
    return;
  }
  if (!models || !models.length) {
    // Ollama reachable but nothing installed — keep the configured model usable.
    if (current) {
      const o = document.createElement("option");
      o.value = current;
      o.textContent = current;
      o.selected = true;
      sel.appendChild(o);
    } else {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No models found — pull one with `ollama pull <name>`";
      o.disabled = true;
      o.selected = true;
      sel.appendChild(o);
    }
    return;
  }

  // Normalize :latest so a configured "llama3.2" matches the "llama3.2:latest"
  // tag instead of appending a spurious "(configured)" entry.
  const norm = (m) => m.replace(/:latest$/, "");
  const currentNorm = norm(current);
  let matched = false;
  for (const name of models) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    if (!matched && (name === current || norm(name) === currentNorm)) {
      o.selected = true;
      matched = true;
    }
    sel.appendChild(o);
  }
  // Keep a configured model that isn't in the list selectable.
  if (current && !matched) {
    const o = document.createElement("option");
    o.value = current;
    o.textContent = `${current} (configured)`;
    o.selected = true;
    sel.appendChild(o);
  }
}

function onModelSelectChange() {
  const model = modelSelectEl.value;
  if (!model) return;
  const conn = activeConnection(state.settings);
  if (!conn) return;
  conn.model = model;
  saveSettings(state.settings);
  renderConnectionSelect(); // refresh the "label · model" text in the connection dropdown
}

function onAgentSelectChange() {
  const id = agentSelectEl.value;
  if (!id) return;
  state.settings.activeAgentId = id;
  saveSettings(state.settings);
}

/* ---------- Streaming chat ---------- */

function inferTask(prompt, agent) {
  const lower = (prompt || "").toLowerCase();
  const agentTags = new Set((agent?.autoTags || []).map((t) => t.toLowerCase()));
  if (looksLikeImageRequest(prompt, agent)) return "image";
  if (agentTags.has("search") || agentTags.has("research") || looksLikeSearchRequest(prompt, agent)) return "search";
  if (agentTags.has("kb") || agentTags.has("knowledge") || looksLikeKBRequest(prompt, agent)) return "kb";
  if (agentTags.has("code") || /\b(code|program|script|bug|javascript|python|html|css|sql|api|json|function|class|debug|refactor)\b/.test(lower)) return "coding";
  if (agentTags.has("write") || /\b(write|draft|essay|email|letter|article|story)\b/.test(lower)) return "write";
  if (agentTags.has("vision") || /\b(image|picture|photo|draw|vision|describe this|what.*see)\b/.test(lower)) return "vision";
  if (/\b(zh|chinese|中文|glm|qwen)\b/.test(lower)) return "chat";
  return "chat";
}

function resolveConnectionAndAgent(settings, text, conv) {
  let connection = activeConnection(settings);
  let agent = activeAgent(settings);
  const isFirstPrompt = conv.messages.filter((m) => m.role === "user").length === 1;
  const promptHash = hashPrompt(text);
  if (isFirstPrompt || state.lastAuto.promptHash !== promptHash) {
    if (settings.activeConnectionId === "auto" || !connection) {
      const task = inferTask(text, agent);
      connection = selectConnection({ settings, task: task === "image" || task === "search" || task === "kb" ? "chat" : task }) || chatConnections(settings)[0] || null;
    }
    if (settings.activeAgentId === "auto" || !agent) {
      agent = pickAgentForPrompt(settings, text);
    }
    state.lastAuto = { connectionId: connection?.id || null, agentId: agent?.id || null, promptHash };
  }
  return { connection, agent };
}

function routeTask(text, agent, settings) {
  const task = inferTask(text, agent);
  if (task === "image") {
    const imgConnection = findEnabledConnection(["dalle", "stability"]);
    if (imgConnection) return { type: "image", connection: imgConnection };
  }
  if (task === "search") {
    const searchConnection = findEnabledConnection(["tavily", "brave_search", "serpapi"]);
    if (searchConnection) return { type: "search", connection: searchConnection };
  }
  if (task === "kb") {
    const embConnection = settings.ragEnabled && settings.ragEmbeddingProvider
      ? findEnabledConnection([settings.ragEmbeddingProvider])
      : null;
    if (embConnection) return { type: "kb", connection: embConnection };
  }
  return { type: "chat" };
}

async function runImageFlow(conv, text, imgConnection, signal) {
  const imageUrl = await generateImage(imgConnection, text, signal);
  await renderImageResult(conv, imgConnection, imageUrl);
}

async function runSearchFlow(conv, text, agent, searchConnection, connection, signal) {
  const results = await searchWeb(searchConnection, text, signal);
  const searchContext = renderSearchContext(results);
  const memoryContext = await getMemoryContext({ query: text, convId: conv.id, agentId: agent?.id, limit: 5 });
  const contextMsg = { role: "system", content: searchContext, ts: nowTs(), hidden: true };
  conv.messages.push(contextMsg);

  state.streamingEl = document.createElement("div");
  state.streamingEl.className = "msg assistant streaming";
  state.streamingEl.innerHTML = '<span class="stream-cursor">▋</span>';
  messagesEl.appendChild(state.streamingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const apiMessages = buildMessages(connection, conv.messages, agent, memoryContext);
  const onChunk = (delta, full) => {
    if (state.streamingEl) state.streamingEl.innerHTML = renderContent(full) + '<span class="stream-cursor">▋</span>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  const { content, usage, connection: usedConnection } = await callWithFallback({
    settings: state.settings,
    messages: apiMessages,
    task: inferTask(text, agent),
    signal,
    onChunk,
    options: { temperature: 0.7, maxTokens: 2048, stream: true },
    preferConnection: connection,
  });
  conv.messages = conv.messages.filter((m) => !m.hidden);
  const finalConnection = usedConnection || connection;
  const result = {
    role: "assistant",
    content,
    usage,
    connection: { id: finalConnection.id, type: finalConnection.type, label: finalConnection.label || typeById(finalConnection.type)?.label || finalConnection.type, model: finalConnection.model },
    agent: agent ? { id: agent.id, label: agent.label } : null,
    ts: nowTs(),
    searchResults: results,
  };
  conv.messages.push(result);
  appendMessageEl(result);
  if (usage?.total_tokens) {
    state.sessionTokens = addSessionUsage(usage.total_tokens);
    renderChatList();
  }
  try {
    await rememberFromMessage(result.content, { scope: "conversation", convId: conv.id, source: "assistant" });
  } catch (e) {
    console.warn("memory extraction failed", e);
  }
  await persistConv(conv);
}

async function runKBFlow(conv, text, agent, embConnection, connection, signal) {
  const queryEmbedding = await embedQuery(embConnection, text, signal);
  const results = await searchKnowledgeBase(queryEmbedding, state.settings.ragTopK);
  if (!results.length) {
    const err = { role: "error", content: "No relevant excerpts found in your knowledge base.", ts: nowTs() };
    conv.messages.push(err);
    appendMessageEl(err);
    await persistConv(conv);
    return;
  }
  const kbContext = formatKBContext(results);
  const memoryContext = await getMemoryContext({ query: text, convId: conv.id, agentId: agent?.id, limit: 5 });
  const contextMsg = { role: "system", content: kbContext, ts: nowTs(), hidden: true };
  conv.messages.push(contextMsg);

  state.streamingEl = document.createElement("div");
  state.streamingEl.className = "msg assistant streaming";
  state.streamingEl.innerHTML = '<span class="stream-cursor">▋</span>';
  messagesEl.appendChild(state.streamingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const apiMessages = buildMessages(connection, conv.messages, agent, memoryContext);
  const onChunk = (delta, full) => {
    if (state.streamingEl) state.streamingEl.innerHTML = renderContent(full) + '<span class="stream-cursor">▋</span>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  const { content, usage, connection: usedConnection } = await callWithFallback({
    settings: state.settings,
    messages: apiMessages,
    task: inferTask(text, agent),
    signal,
    onChunk,
    options: { temperature: 0.7, maxTokens: 2048, stream: true },
    preferConnection: connection,
  });
  conv.messages = conv.messages.filter((m) => !m.hidden);
  const finalConnection = usedConnection || connection;
  const result = {
    role: "assistant",
    content,
    usage,
    connection: { id: finalConnection.id, type: finalConnection.type, label: finalConnection.label || typeById(finalConnection.type)?.label || finalConnection.type, model: finalConnection.model },
    agent: agent ? { id: agent.id, label: agent.label } : null,
    ts: nowTs(),
    kbSources: results.map((r) => r.fileName),
  };
  conv.messages.push(result);
  appendMessageEl(result);
  if (usage?.total_tokens) {
    state.sessionTokens = addSessionUsage(usage.total_tokens);
    renderChatList();
  }
  try {
    await rememberFromMessage(result.content, { scope: "conversation", convId: conv.id, source: "assistant" });
  } catch (e) {
    console.warn("memory extraction failed", e);
  }
  await persistConv(conv);
}

async function runChatFlow(conv, text, agent, connection, signal) {
  const task = inferTask(text, agent);
  const memoryContext = await getMemoryContext({ query: text, convId: conv.id, agentId: agent?.id, limit: 5 });
  const apiMessages = buildMessages(connection, conv.messages, agent, memoryContext);

  state.streamingEl = document.createElement("div");
  state.streamingEl.className = "msg assistant streaming";
  state.streamingEl.innerHTML = '<span class="stream-cursor">▋</span>';
  messagesEl.appendChild(state.streamingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const onChunk = (delta, full) => {
    if (state.streamingEl) {
      state.streamingEl.innerHTML = renderContent(full) + '<span class="stream-cursor">▋</span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  };

  const { content, usage, connection: usedConnection } = await callWithFallback({
    settings: state.settings,
    messages: apiMessages,
    task,
    signal,
    onChunk,
    options: { temperature: 0.7, maxTokens: 2048, stream: true },
    preferConnection: connection,
  });
  const finalConnection = usedConnection || connection;
  const result = {
    role: "assistant",
    content,
    usage,
    connection: { id: finalConnection.id, type: finalConnection.type, label: finalConnection.label || typeById(finalConnection.type)?.label || finalConnection.type, model: finalConnection.model },
    agent: agent ? { id: agent.id, label: agent.label } : null,
    ts: nowTs(),
  };
  if (usage?.total_tokens) {
    state.sessionTokens = addSessionUsage(usage.total_tokens);
    renderChatList();
  }
  return result;
}


function setBusy(busy) {
  state.streaming = busy;
  stopBtn.hidden = !busy;
  if (sendBtn) {
    sendBtn.hidden = busy;
    if (!busy) sendBtn.disabled = false;
  }
  if (!busy) state.abortCtrl = null;
}

function beginStreaming() {
  state.abortCtrl = new AbortController();
  setBusy(true);
}

function clearStreamingEl() {
  if (state.streamingEl) {
    state.streamingEl.remove();
    state.streamingEl = null;
  }
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if ((!text && !pendingAttachments.length) || state.streaming) return;
  inputEl.value = "";
  autoGrow();
  if (sendBtn) sendBtn.disabled = true;

  let conv = null;
  let typingEl = null;
  try {
    conv = await ensureConv();
    const content = buildMessageContent(text, pendingAttachments);
    const userMsg = { role: "user", content, attachments: pendingAttachments, ts: nowTs() };
    clearAttachments();
    conv.messages.push(userMsg);
    if (conv.title === "New chat") conv.title = titleFrom(content);
    await persistConv(conv);
    appendMessageEl(userMsg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Remember factual notes from the user's message.
    try {
      await rememberFromMessage(extractText(content), { scope: "conversation", convId: conv.id, source: "user" });
    } catch (e) {
      console.warn("memory extraction failed", e);
    }

    const { connection, agent } = resolveConnectionAndAgent(state.settings, text, conv);

    if (!connection) {
      const err = { role: "error", content: "No API connection configured. Open Settings and add one.", ts: nowTs() };
      conv.messages.push(err);
      appendMessageEl(err);
      await persistConv(conv);
      return;
    }

    if (!state.settings.onlineMode && connection?.type !== "webllm") {
      const err = { role: "error", content: "Offline mode is on. Enable Online to send AI requests.", ts: nowTs() };
      conv.messages.push(err);
      appendMessageEl(err);
      await persistConv(conv);
      return;
    }

    // Check that the webllm model is actually installed before sending
    if (connection?.type === "webllm" && !isModelInstalled(connection.modelId)) {
      const err = { role: "error", content: "Offline model not installed. Go to Settings to download it.", ts: nowTs() };
      conv.messages.push(err);
      appendMessageEl(err);
      await persistConv(conv);
      return;
    }

    typingEl = document.createElement("div");
    typingEl.className = "msg assistant typing";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    beginStreaming();

    let result = null;
    let lastErr = null;
    try {
      const route = routeTask(text, agent, state.settings);
      if (route.type === "image") {
        typingEl.remove();
        await runImageFlow(conv, text, route.connection, state.abortCtrl.signal);
      } else if (route.type === "search") {
        typingEl.remove();
        await runSearchFlow(conv, text, agent, route.connection, connection, state.abortCtrl.signal);
      } else if (route.type === "kb") {
        typingEl.remove();
        await runKBFlow(conv, text, agent, route.connection, connection, state.abortCtrl.signal);
      } else {
        typingEl.remove();
        result = await runChatFlow(conv, text, agent, connection, state.abortCtrl.signal);
      }
    } catch (e) {
      if (e.name === "AbortError" || e.message === "aborted" || e?.target?.name === "AbortError") lastErr = "aborted";
      else lastErr = e.message || String(e);
    }

    clearStreamingEl();
    if (result) {
      conv.messages.push(result);
      appendMessageEl(result);
      // Remember factual notes from the assistant response.
      try {
        await rememberFromMessage(result.content, { scope: "conversation", convId: conv.id, source: "assistant" });
      } catch (e) {
        console.warn("memory extraction failed", e);
      }
      await persistConv(conv);
    } else if (lastErr === "aborted") {
      appendMessageEl({ role: "system", content: "(stopped)" });
      await persistConv(conv);
    } else if (lastErr) {
      const err = { role: "error", content: `Request failed: ${lastErr}`, ts: nowTs() };
      conv.messages.push(err);
      appendMessageEl(err);
      await persistConv(conv);
    }
  } catch (e) {
    console.error("sendMessage error", e);
    const errMsg = e?.message || String(e) || "unknown error";
    const err = { role: "error", content: `Failed to send: ${errMsg}`, ts: nowTs() };
    if (conv) {
      conv.messages.push(err);
      appendMessageEl(err);
      persistConv(conv).catch(() => {});
    } else {
      appendMessageEl(err);
    }
  } finally {
    if (typingEl) typingEl.remove();
    clearStreamingEl();
    setBusy(false);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function hashPrompt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function buildMessages(connection, history, agent, memoryContext = "") {
  const sys = agent?.prompt?.trim();
  const messages = [];
  if (sys) messages.push({ role: "system", content: sys });
  if (memoryContext?.trim()) {
    messages.push({ role: "system", content: memoryContext.trim() });
  }
  for (const m of history) {
    if (m.role === "system" && m.content?.trim() && !messages.find((x) => x.role === "system" && x.content === m.content)) {
      messages.push({ role: "system", content: m.content });
    }
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  return messages;
}

async function callConnection(connection, history, agent, signal, options = {}) {
  const type = typeById(connection.type);
  // webllm connections don't need an endpoint (they run locally)
  if (!connection.endpoint && connection.type !== "webllm") throw new Error("No endpoint configured");
  if (!connection.model && !type?.defaultModel) throw new Error("No model configured");

  const messages = buildMessages(connection, history, agent);
  return callModel({ connection, messages, signal, options });
}

function stopStreaming() {
  if (state.abortCtrl) state.abortCtrl.abort();
}


/* ---------- Settings dialog ---------- */
function openSettings() {
  const dlg = $("settings-dialog");
  if (!dlg) { console.error("Settings dialog element not found"); return; }

  renderProvidersList();
  renderAgentsList();

  if (dlg.open) dlg.close();
  dlg.classList.remove("dialog-open");
  if (typeof dlg.showModal === "function") {
    dlg.showModal();
    if (!dlg.open) {
      dlg.setAttribute("open", "");
      dlg.classList.add("dialog-open");
    }
  } else {
    dlg.setAttribute("open", "");
    dlg.classList.add("dialog-open");
  }
}

function closeSettings() {
  try {
    const dlg = $("settings-dialog");
    dlg.close();
    dlg.classList.remove("dialog-open");
    dlg.removeAttribute("open");
  } catch {}
}

function renderConnectionsList() {
  try {
    const list = $("connections-list");
    if (!list) return;
    list.innerHTML = "";
    const connections = state.settings.connections || [];
    if (connections.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "No connections yet. Tap Add connection to set one up.";
      list.appendChild(empty);
      return;
    }
  const rows = document.createElement("div");
  rows.className = "rows";
  for (const c of connections) {
    const row = document.createElement("div");
    row.className = "row-item" + (c.enabled === false ? " disabled" : "");

    const info = document.createElement("div");
    info.className = "row-info";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = c.label || typeById(c.type)?.label || c.type;
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = `${c.model || "no model"} · ${c.endpoint || "no endpoint"}`;
    info.append(title, sub);

    const controls = document.createElement("div");
    controls.className = "row-actions";

    const toggle = renderToggle(c.enabled !== false, "Enable connection", (on) => {
      c.enabled = on;
      saveSettings(state.settings);
      renderConnectionsList();
      renderConnectionSelect();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.title = "Edit connection";
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.onclick = () => openAddConnection(c);

    controls.append(toggle, editBtn);
    row.append(info, controls);
    rows.appendChild(row);
  }
  list.appendChild(rows);
  } catch (e) {
    console.error("renderConnectionsList failed", e);
    const list = $("connections-list");
    if (list) list.innerHTML = `<div class="empty-hint" style="color:var(--color-error)">Failed to load connections: ${escapeHtml(e.message || e)}</div>`;
  }
}

/* ---------- Offline models ---------- */

// ── Model picker helpers ─────────────────────────────────────────────────────

// ── Model picker dialog ───────────────────────────────────────────────────────

function formatModelSize(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
  return mb + " MB";
}

/* ---------- Unified add-model dialog ---------- */

function switchAddModelTab(tab) {
  const offlineBtn = $("tab-btn-offline");
  const apiBtn = $("tab-btn-api");
  const offlinePanel = $("tab-offline");
  const apiPanel = $("tab-api");
  if (!offlineBtn || !apiBtn || !offlinePanel || !apiPanel) return;

  const isOffline = tab === "offline";
  offlineBtn.classList.toggle("active", isOffline);
  apiBtn.classList.toggle("active", !isOffline);
  offlineBtn.setAttribute("aria-selected", String(isOffline));
  apiBtn.setAttribute("aria-selected", String(!isOffline));
  offlinePanel.hidden = !isOffline;
  apiPanel.hidden = isOffline;

  if (isOffline) ensureOfflinePickerRendered();
  if (tab === "api") ensureApiFormReady();
}

let offlinePickerRendered = false;
async function ensureOfflinePickerRendered() {
  if (offlinePickerRendered) return;
  offlinePickerRendered = true;
  try {
    modelRegistry = await fetchModelRegistry();
  } catch (err) {
    console.warn("Failed to fetch model registry", err);
    modelRegistry = DEFAULT_MODEL_REGISTRY;
  }
  const hw = await detectHardware();
  const recommendedTier = recommendTier(hw);
  renderModelPickerDialog(modelRegistry, recommendedTier);
}

function openAddModelDialog(tab = "offline") {
  if (!addModelDialog) return;
  switchAddModelTab(tab);
  if (addModelDialog.open) addModelDialog.close();
  addModelDialog.classList.remove("dialog-open");
  if (typeof addModelDialog.showModal === "function") {
    addModelDialog.showModal();
    if (!addModelDialog.open) {
      addModelDialog.setAttribute("open", "");
      addModelDialog.classList.add("dialog-open");
    }
  } else {
    addModelDialog.setAttribute("open", "");
    addModelDialog.classList.add("dialog-open");
  }
}

function closeAddModelDialog() {
  try {
    addModelDialog.close();
    addModelDialog.classList.remove("dialog-open");
    addModelDialog.removeAttribute("open");
  } catch {}
}

function renderModelPickerDialog(registry, recommendedTier) {
  if (!offlineModelList) return;
  offlineModelList.innerHTML = "";

  // Reset any previous state

  for (const m of registry) {
    const card = document.createElement("div");
    card.className = "model-select-card";
    if (m.tier === recommendedTier) card.classList.add("recommended");

    // Check if already installed
    const installed = isModelInstalled(m.id);
    if (installed) {
      card.classList.add("installed");
    }

    // Header: name + recommended badge
    const header = document.createElement("div");
    header.className = "model-card-header";
    const name = document.createElement("span");
    name.className = "model-card-name";
    name.textContent = m.name;
    header.appendChild(name);
    if (m.tier === recommendedTier) {
      const badge = document.createElement("span");
      badge.className = "model-recommended-badge";
      badge.textContent = "Recommended";
      header.appendChild(badge);
    }
    if (installed) {
      const badge = document.createElement("span");
      badge.className = "model-installed-badge";
      badge.textContent = "installed";
      header.appendChild(badge);
    }
    card.appendChild(header);

    // Details: params · context · size
    const details = document.createElement("div");
    details.className = "model-card-details";
    details.textContent = `${m.params} params · ${m.ctx.toLocaleString()} context · ${formatModelSize(m.sizeMB)}`;
    card.appendChild(details);

    // Description
    const desc = document.createElement("div");
    desc.className = "model-card-desc";
    desc.textContent = m.description;
    card.appendChild(desc);

    // Hardware requirements
    const hw = document.createElement("div");
    hw.className = "model-card-hw";
    const hwInfo = m.hardware || { minMemoryGB: 0, webgpu: false };
    const parts = [`Requires ${hwInfo.minMemoryGB || 0} GB+ RAM`];
    if (hwInfo.webgpu) parts.push("WebGPU recommended");
    hw.textContent = parts.join(" · ");
    card.appendChild(hw);

    // Click handler — install immediately
    if (!installed) {
      card.addEventListener("click", () => installOfflineModel(m));
    }

    offlineModelList.appendChild(card);
  }
}

async function renderOfflineModels() {
  try {
    // Fetch model registry (with remote merge)
    try {
      modelRegistry = await fetchModelRegistry();
    } catch (e) {
      console.warn("Failed to fetch model registry", e);
      modelRegistry = DEFAULT_MODEL_REGISTRY;
    }

    // Detect hardware and recommend tier
    const hw = await detectHardware();
    const recommendedTier = recommendTier(hw);

    // Check installed models
    const installed = getInstalledModels();

    // Render installed models list
    renderInstalledModelsList(installed, modelRegistry);
  } catch (e) {
    console.error("renderOfflineModels failed", e);
    const container = $("offline-installed-models");
    if (container) container.innerHTML = `<div class="empty-hint" style="color:var(--color-error)">Failed to load: ${escapeHtml(e.message || e)}</div>`;
  }
}

function renderInstalledModelsList(installed, registry) {
  const container = $("offline-installed-models");
  if (!container) return;
  container.innerHTML = "";
  const installedIds = Object.keys(installed || {});

  if (installedIds.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "No models installed. Click Add to install one.";
    container.appendChild(empty);
    return;
  }

  const rows = document.createElement("div");
  rows.className = "rows";

  for (const modelId of installedIds) {
    const modelInfo = registry.find((m) => m.id === modelId);
    if (!modelInfo) continue;

    const row = document.createElement("div");
    row.className = "row-item";

    const info = document.createElement("div");
    info.className = "row-info";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = modelInfo.name;
    const badge = document.createElement("span");
    badge.className = "model-installed-badge";
    badge.textContent = "installed";
    title.appendChild(badge);
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = `${modelInfo.params} params · ${modelInfo.ctx.toLocaleString()} context · ${formatModelSize(modelInfo.sizeMB)}`;
    info.append(title, sub);

    const controls = document.createElement("div");
    controls.className = "row-actions";

    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-btn danger";
    removeBtn.title = "Remove model";
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    removeBtn.onclick = () => removeOfflineModel(modelId, modelInfo);

    controls.append(removeBtn);
    row.append(info, controls);
    rows.appendChild(row);
  }

  container.appendChild(rows);
}

/* ---------- Download tracking (sidebar) ---------- */

function renderDownloadList() {
  if (!downloadListEl) return;
  downloadListEl.innerHTML = "";
  const entries = Array.from(downloads.values());
  if (entries.length === 0) {
    if (downloadStatusEl) downloadStatusEl.hidden = true;
    return;
  }
  if (downloadStatusEl) downloadStatusEl.hidden = false;

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "download-item";
    item.dataset.id = entry.modelId;

    // Header: name + status badge
    const header = document.createElement("div");
    header.className = "download-item-header";

    const name = document.createElement("span");
    name.className = "download-item-name";
    name.textContent = entry.model?.name || entry.modelId;
    header.appendChild(name);

    const status = document.createElement("span");
    status.className = "download-item-status " + entry.status;
    if (entry.status === "downloading") status.textContent = "DL";
    else if (entry.status === "completed") status.textContent = "Done";
    else if (entry.status === "error") status.textContent = "Error";
    header.appendChild(status);

    // Dismiss button for completed/error
    if (entry.status === "completed" || entry.status === "error") {
      const dismiss = document.createElement("button");
      dismiss.className = "download-item-dismiss";
      dismiss.title = "Dismiss";
      dismiss.setAttribute("aria-label", "Dismiss download status");
      dismiss.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
      dismiss.onclick = () => { downloads.delete(entry.modelId); renderDownloadList(); };
      header.appendChild(dismiss);
    }

    item.appendChild(header);

    // Progress bar
    const barWrap = document.createElement("div");
    barWrap.className = "download-item-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "download-item-bar" + (entry.status === "completed" ? " completed" : entry.status === "error" ? " error" : "");
    bar.style.width = entry.progress + "%";
    barWrap.appendChild(bar);
    item.appendChild(barWrap);

    // Info row: percentage + size
    const info = document.createElement("div");
    info.className = "download-item-info";
    const pct = document.createElement("span");
    pct.className = "download-item-pct";
    pct.textContent = entry.progress + "%";
    info.appendChild(pct);
    if (entry.sizeText) {
      const size = document.createElement("span");
      size.className = "download-item-size";
      size.textContent = entry.sizeText;
      info.appendChild(size);
    }
    item.appendChild(info);

    // Speed + ETA row
    if (entry.speedText || entry.etaText) {
      const speedRow = document.createElement("div");
      speedRow.className = "download-item-speed-row";
      if (entry.speedText) {
        const speedEl = document.createElement("span");
        speedEl.className = "download-item-speed";
        speedEl.textContent = entry.speedText;
        speedRow.appendChild(speedEl);
      }
      if (entry.etaText) {
        const etaEl = document.createElement("span");
        etaEl.className = "download-item-eta";
        etaEl.textContent = `ETA: ${entry.etaText}`;
        speedRow.appendChild(etaEl);
      }
      item.appendChild(speedRow);
    }

    // Error message + retry
    if (entry.status === "error" && entry.error) {
      const errEl = document.createElement("div");
      errEl.className = "download-item-error";
      errEl.textContent = entry.error;
      item.appendChild(errEl);
      const retry = document.createElement("button");
      retry.className = "download-item-retry";
      retry.textContent = "Retry";
      retry.onclick = () => installOfflineModel(entry.model);
      item.appendChild(retry);
    }

    downloadListEl.appendChild(item);
  }
}

function addDownloadEntry(model) {
  downloads.set(model.id, {
    modelId: model.id,
    model,
    progress: 0,
    status: "downloading",
    sizeText: "",
    error: "",
  });
  renderDownloadList();
}

function updateDownloadEntry(modelId, data) {
  const entry = downloads.get(modelId);
  if (!entry) return;
  Object.assign(entry, data);
  renderDownloadList();
}

function removeDownloadEntry(modelId) {
  downloads.delete(modelId);
  renderDownloadList();
}

async function installOfflineModel(model) {
  if (!model) return;

  // Guard: check if already installed
  if (isModelInstalled(model.id)) {
    renderProvidersList();
    return;
  }

  // Guard: check if already downloading
  if (downloads.has(model.id) && downloads.get(model.id).status === "downloading") {
    return;
  }

  // Close dialogs
  closeAddModelDialog();
  closeSettings();

  // Add download entry to sidebar
  addDownloadEntry(model);

  try {
    // Step 1: Download the GGUF file with progress (queued sequentially)
    await enqueueDownload(model.id, model.url, ({ received, total, speed, eta }) => {
      const pct = total > 0 ? Math.round((received / total) * 100) : 0;
      const sizeText = total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : "";
      const speedText = formatSpeed(speed);
      const etaText = formatETA(eta);
      updateDownloadEntry(model.id, { progress: pct, sizeText, speedText, etaText });
    });

    // Step 2: Auto-create a connection if one doesn't exist
    const existingConn = state.settings.connections.find(
      (c) => c.type === "webllm" && c.modelId === model.id
    );
    if (!existingConn) {
      state.settings.connections.push({
        id: uid(),
        type: "webllm",
        label: model.name,
        endpoint: "",
        model: model.defaultModel || model.id,
        modelId: model.id,
        key: "",
        enabled: true,
      });
      saveSettings(state.settings);
      renderProvidersList();
      renderConnectionSelect();
    }

    // Step 3: Mark as completed
    updateDownloadEntry(model.id, { progress: 100, status: "completed", sizeText: formatBytes(model.sizeMB * 1024 * 1024) });
    await renderProvidersList();
  } catch (e) {
    console.error("Model install failed", e);
    updateDownloadEntry(model.id, { status: "error", error: e.message || String(e) });
  }
}

async function removeOfflineModel(modelId, modelInfo) {
  if (!modelInfo) return;
  if (!confirm(`Remove "${modelInfo.name}"? The downloaded model file will be deleted.`)) return;

  try {
    // Remove from cache
    await removeInstalledModel(modelId);

    // Clean up any download entry
    removeDownloadEntry(modelId);

    // Remove the associated connection
    state.settings.connections = state.settings.connections.filter(
      (c) => !(c.type === "webllm" && c.modelId === modelId)
    );
    saveSettings(state.settings);
    renderProvidersList();
    renderConnectionSelect();

    // Re-render providers list
    await renderProvidersList();
  } catch (e) {
    console.error("Model removal failed", e);
    const container = $("offline-installed-models");
    if (container) container.innerHTML = `<div class="empty-hint" style="color:var(--color-error)">Remove failed: ${escapeHtml(e.message || e)}</div>`;
  }
}

function renderAgentsList() {
  try {
    const list = $("agents-list");
    if (!list) return;
    list.innerHTML = "";
  const agents = mergeAgents(state.settings.agents).filter((a) => !DEFAULT_AGENT_IDS.has(a.id));
  if (agents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "No custom agents yet. Tap Add agent to create one.";
    list.appendChild(empty);
    return;
  }
  const rows = document.createElement("div");
  rows.className = "rows";
  for (const a of agents) {
    const row = document.createElement("div");
    row.className = "row-item" + (a.enabled === false ? " disabled" : "");

    const info = document.createElement("div");
    info.className = "row-info";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = a.label || "Agent";
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = a.prompt ? a.prompt.slice(0, 90).replace(/\n/g, " ") + (a.prompt.length > 90 ? "…" : "") : "No prompt";
    info.append(title, sub);

    const controls = document.createElement("div");
    controls.className = "row-actions";

    const toggle = renderToggle(a.enabled !== false, "Enable agent", (on) => {
      const stored = state.settings.agents.find((x) => x.id === a.id);
      if (stored) {
        stored.enabled = on;
      } else {
        state.settings.agents.push({ id: a.id, enabled: on });
      }
      a.enabled = on;
      saveSettings(state.settings);
      renderAgentsList();
      renderAgentSelect();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.title = "Edit agent";
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.onclick = () => openAddAgent(a);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn danger";
    deleteBtn.title = "Delete custom agent";
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    deleteBtn.onclick = () => {
      if (confirm(`Delete the custom agent "${a.label || "Agent"}"?`)) {
        state.settings.agents = state.settings.agents.filter((x) => x.id !== a.id);
        saveSettings(state.settings);
        renderAgentsList();
        renderAgentSelect();
      }
    };

    controls.append(toggle, editBtn, deleteBtn);
    row.append(info, controls);
    rows.appendChild(row);
  }
  list.appendChild(rows);
  } catch (e) {
    console.error("renderAgentsList failed", e);
    const list = $("agents-list");
    if (list) list.innerHTML = `<div class="empty-hint" style="color:var(--color-error)">Failed to load agents: ${escapeHtml(e.message || e)}</div>`;
  }
}

function renderProvidersList() {
  try {
    const list = document.getElementById('providers-list');
    if (!list) return;
    list.innerHTML = '';

    const connections = state.settings.connections || [];
    const installed = getInstalledModels();
    const installedIds = Object.keys(installed || {});
    const hasItems = connections.length > 0 || installedIds.length > 0;

    if (!hasItems) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'No AI providers configured. Tap Add to connect an API or install a local model.';
      list.appendChild(empty);
      return;
    }

    const rows = document.createElement('div');
    rows.className = 'rows';

    // Offline (browser) models first — private, run 100% in the browser.
    for (const modelId of installedIds) {
      const modelInfo = modelRegistry.find((m) => m.id === modelId);
      if (!modelInfo) continue;

      const row = document.createElement('div');
      row.className = 'row-item';

      const info = document.createElement('div');
      info.className = 'row-info';
      const title = document.createElement('div');
      title.className = 'row-title';
      title.textContent = modelInfo.name;
      const badge = document.createElement('span');
      badge.className = 'model-installed-badge';
      badge.textContent = 'installed';
      title.appendChild(badge);
      const privacy = document.createElement('span');
      privacy.className = 'privacy-badge';
      privacy.textContent = 'private · browser';
      title.appendChild(privacy);
      const sub = document.createElement('div');
      sub.className = 'row-sub';
      sub.textContent = modelInfo.params + ' params · ' + modelInfo.ctx.toLocaleString() + ' context · ' + formatModelSize(modelInfo.sizeMB);
      info.append(title, sub);

      const controls = document.createElement('div');
      controls.className = 'row-actions';

      // Toggle the matching webllm connection (if one exists).
      const conn = connections.find((c) => c.type === 'webllm' && c.modelId === modelId);
      if (conn) {
        const toggle = renderToggle(conn.enabled !== false, 'Enable offline model', (on) => {
          conn.enabled = on;
          saveSettings(state.settings);
          renderProvidersList();
          renderConnectionSelect();
        });
        controls.appendChild(toggle);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn danger';
      removeBtn.title = 'Remove model';
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      removeBtn.onclick = () => removeOfflineModel(modelId, modelInfo);

      controls.append(removeBtn);
      row.append(info, controls);
      rows.appendChild(row);
    }

    // Local server connections (Ollama, llama.cpp) next.
    for (const c of connections.filter((x) => x.type === 'ollama' || x.type === 'llamacpp')) {
      rows.appendChild(renderConnectionRow(c));
    }

    // API connections last (webllm is handled by the offline section above).
    for (const c of connections.filter((x) => x.type !== 'webllm' && x.type !== 'ollama' && x.type !== 'llamacpp')) {
      rows.appendChild(renderConnectionRow(c));
    }

    list.appendChild(rows);
  } catch (e) {
    console.error('renderProvidersList failed', e);
    const list = document.getElementById('providers-list');
    if (list) list.innerHTML = '<div class="empty-hint" style="color:var(--color-error)">Failed to load providers: ' + escapeHtml(e.message || e) + '</div>';
  }
}

// Build a settings row for a non-offline connection (local server or API).
function renderConnectionRow(c) {
  const row = document.createElement('div');
  row.className = 'row-item' + (c.enabled === false ? ' disabled' : '');

  const info = document.createElement('div');
  info.className = 'row-info';
  const title = document.createElement('div');
  title.className = 'row-title';
  title.textContent = c.label || typeById(c.type)?.label || c.type;
  const sub = document.createElement('div');
  sub.className = 'row-sub';
  sub.textContent = (c.model || 'no model') + ' · ' + (c.endpoint || 'no endpoint');
  info.append(title, sub);

  const controls = document.createElement('div');
  controls.className = 'row-actions';

  const toggle = renderToggle(c.enabled !== false, 'Enable connection', (on) => {
    c.enabled = on;
    saveSettings(state.settings);
    renderProvidersList();
    renderConnectionSelect();
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.title = 'Edit connection';
  editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  editBtn.onclick = () => openAddConnection(c);

  // Ollama connections can sync the model currently loaded in the server's
  // memory (/api/ps), falling back to the first installed model (/api/tags).
  let syncBtn = null;
  if (c.type === 'ollama') {
    syncBtn = document.createElement('button');
    syncBtn.className = 'icon-btn';
    syncBtn.title = 'Sync loaded model from Ollama';
    syncBtn.setAttribute('aria-label', 'Sync loaded model from Ollama');
    syncBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      sub.textContent = 'Syncing loaded model…';
      try {
        const [loaded, installed] = await Promise.all([
          fetchOllamaLoadedModel(c.endpoint),
          fetchOllamaModels(c.endpoint),
        ]);
        const target = loaded[0] || installed[0] || null;
        if (!target) {
          sub.textContent = 'No models found on Ollama';
          return;
        }
        c.model = target;
        saveSettings(state.settings);
        renderProvidersList();
        renderConnectionSelect();
      } catch {
        sub.textContent = "Couldn't reach Ollama — is it running?";
      } finally {
        syncBtn.disabled = false;
      }
    };
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn danger';
  deleteBtn.title = 'Delete connection';
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  deleteBtn.onclick = () => {
    if (confirm(`Delete the connection "${c.label || typeById(c.type)?.label || c.type}"?`)) {
      state.settings.connections = state.settings.connections.filter((x) => x.id !== c.id);
      saveSettings(state.settings);
      renderProvidersList();
      renderConnectionSelect();
    }
  };

  controls.append(toggle, ...(syncBtn ? [syncBtn] : []), editBtn, deleteBtn);
  row.append(info, controls);
  return row;
}

function renderToggle(checked, ariaLabel, onChange) {
  const label = document.createElement("label");
  label.className = "toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.setAttribute("role", "switch");
  cb.setAttribute("aria-label", ariaLabel);
  cb.onchange = () => onChange(cb.checked);
  const slider = document.createElement("span");
  slider.className = "toggle-slider";
  label.append(cb, slider);
  return label;
}

/* ---------- Add / edit connection ---------- */

// Fill the API-tab Type dropdown with every connection type.
function populateTypeSelect(selectedId) {
  const typeSelect = $("add-type");
  typeSelect.innerHTML = "";
  for (const id of CONNECTION_TYPE_ORDER) {
    const t = CONNECTION_TYPES[id];
    const o = document.createElement("option");
    o.value = id;
    o.textContent = t.label;
    typeSelect.appendChild(o);
  }
  if (selectedId) typeSelect.value = selectedId;
}

// Update the API-tab form fields for the given connection type.
function updateAddForm(typeId, editingId) {
  const t = typeById(typeId);
  // Tint the Type control with the provider's accent color (matches the
  // offline model cards' colored badges).
  const form = $("add-form");
  if (form) form.style.setProperty("--provider-accent", t.accent || "");
  $("add-prompt").textContent = t.prompt || "";
  $("add-key-label").textContent = t.keyLabel || "API key";
  $("add-key").placeholder = t.keyHint || "";
  $("add-endpoint").placeholder = t.endpointHint || t.defaultEndpoint || "https://your-endpoint.com/v1/chat/completions";
  $("add-model").placeholder = t.modelHint || t.defaultModel || "";
  if (!editingId) {
    $("add-endpoint").value = t.defaultEndpoint || "";
    $("add-model").value = t.defaultModel || "";
  }
  const keyWrap = $("add-key-wrap");
  keyWrap.hidden = false;
  $("add-key").required = t.keyRequired === true;
  $("add-key").placeholder = t.keyHint || "Paste API key (optional)";

  // Manage model datalist for combo box behavior
  const modelInput = $("add-model");
  const existingDatalist = document.getElementById("add-model-list");
  if (t.models && t.models.length > 0) {
    let datalist = existingDatalist;
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "add-model-list";
      modelInput.parentNode.insertBefore(datalist, modelInput.nextSibling);
    }
    datalist.innerHTML = "";
    for (const modelName of t.models) {
      const option = document.createElement("option");
      option.value = modelName;
      datalist.appendChild(option);
    }
    modelInput.setAttribute("list", "add-model-list");
  } else {
    if (existingDatalist) {
      existingDatalist.remove();
    }
    modelInput.removeAttribute("list");
  }

  // Ollama: fetch the live model list into the combo box. The refresh button
  // and status hint only make sense for types that have a live model list.
  const isOllama = typeId === "ollama";
  const refreshBtn = $("btn-refresh-models");
  const hint = $("add-model-hint");
  if (refreshBtn) refreshBtn.hidden = !isOllama;
  if (hint) hint.hidden = !isOllama;
  const syncBtn = $("btn-sync-loaded-model");
  if (syncBtn) syncBtn.hidden = !isOllama;
  if (isOllama) refreshOllamaModelList();
}

// Populate the API-tab form the first time it's shown (e.g. "+ Add model" →
// API tab), so the Type dropdown is never empty. No-op once populated.
function ensureApiFormReady() {
  const typeSelect = $("add-type");
  if (typeSelect.options.length === 0) {
    populateTypeSelect(CONNECTION_TYPE_ORDER[0]);
    updateAddForm(typeSelect.value, $("add-form").dataset.editing || null);
  }
}

// Fetch installed models from the Ollama server and populate the Model combo
// box. Fresh fetch (no cache) so newly-pulled models show up; the composer's
// ollamaModelsCache is untouched.
async function refreshOllamaModelList() {
  const typeId = $("add-type").value;
  if (typeId !== "ollama") return;
  const t = typeById(typeId);
  const endpoint = $("add-endpoint").value.trim() || t?.defaultEndpoint || "";
  const modelInput = $("add-model");
  const hint = $("add-model-hint");
  const base = ollamaBaseUrl(endpoint);
  if (!base) {
    if (hint) hint.textContent = "";
    return;
  }
  if (hint) hint.textContent = "Loading models…";
  try {
    const models = await fetchOllamaModels(endpoint);
    if ($("add-type").value !== typeId) return; // type changed mid-fetch
    let datalist = document.getElementById("add-model-list");
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "add-model-list";
      modelInput.parentNode.insertBefore(datalist, modelInput.nextSibling);
    }
    datalist.innerHTML = "";
    for (const name of models) {
      const o = document.createElement("option");
      o.value = name;
      datalist.appendChild(o);
    }
    modelInput.setAttribute("list", "add-model-list");
    if (hint) {
      hint.textContent = models.length
        ? `${models.length} model${models.length === 1 ? "" : "s"} from Ollama`
        : "No models found — pull one with `ollama pull <name>`";
    }
  } catch {
    if (hint) hint.textContent = "Couldn't reach Ollama — you can type a model name manually";
  }
}

// Detect the model currently loaded in Ollama (/api/ps) and set it as the
// connection's model. Falls back to the first installed model (/api/tags)
// when nothing is loaded and the field is empty. Self-guards to the ollama
// type and guards against a type change mid-fetch (same as refreshOllamaModelList).
async function syncOllamaLoadedModel() {
  const typeId = $("add-type").value;
  if (typeId !== "ollama") return;
  const t = typeById(typeId);
  const endpoint = $("add-endpoint").value.trim() || t?.defaultEndpoint || "";
  const modelInput = $("add-model");
  const hint = $("add-model-hint");
  const base = ollamaBaseUrl(endpoint);
  if (!base) {
    if (hint) hint.textContent = "Enter a valid Ollama endpoint first";
    return;
  }
  if (hint) hint.textContent = "Syncing loaded model…";
  try {
    const [loaded, installed] = await Promise.all([
      fetchOllamaLoadedModel(endpoint),
      fetchOllamaModels(endpoint),
    ]);
    if ($("add-type").value !== typeId) return; // type changed mid-fetch
    const current = modelInput.value.trim();
    const target = loaded[0] || (current ? null : installed[0]) || null;
    if (target) {
      modelInput.value = target;
      if (hint) {
        hint.textContent = loaded.length
          ? `Synced loaded model: ${target}`
          : `No model loaded — using first installed: ${target}`;
      }
    } else if (hint) {
      hint.textContent = "No models found — pull one with `ollama pull <name>`";
    }
  } catch {
    if (hint) hint.textContent = "Couldn't reach Ollama — you can type a model name manually";
  }
}

function openAddConnection(existing = null) {
  const dlg = $("add-model-dialog");
  const editingId = existing?.id || null;
  $("add-form").dataset.editing = editingId || "";
  $("add-model-title").textContent = editingId ? "Edit connection" : "Add connection";

  const typeSelect = $("add-type");
  populateTypeSelect(existing?.type || CONNECTION_TYPE_ORDER[0]);

  if (existing) {
    $("add-label").value = existing.label || "";
    $("add-endpoint").value = existing.endpoint || "";
    $("add-model").value = existing.model || "";
    $("add-key").value = existing.key || "";
  } else {
    $("add-label").value = "";
    $("add-endpoint").value = "";
    $("add-model").value = "";
    $("add-key").value = "";
  }
  updateAddForm(typeSelect.value, editingId);

  typeSelect.onchange = () => updateAddForm(typeSelect.value, $("add-form").dataset.editing || null);
  $("add-test-result").textContent = "";

  switchAddModelTab("api");
  if (dlg.open) dlg.close();
  if (typeof dlg.showModal === "function") dlg.showModal();
  else {
    dlg.setAttribute("open", "");
    dlg.classList.add("dialog-open");
  }
  typeSelect.focus();
}

function closeAddConnection() {
  try {
    const dlg = $("add-model-dialog");
    dlg.close();
    dlg.classList.remove("dialog-open");
    dlg.removeAttribute("open");
  } catch {}
}

function saveConnectionFromDialog() {
  const editingId = $("add-form").dataset.editing || null;
  const typeId = $("add-type").value;
  const t = typeById(typeId);
  const label = $("add-label").value.trim() || t.label;
  const endpoint = $("add-endpoint").value.trim() || t.defaultEndpoint;
  const model = $("add-model").value.trim() || t.defaultModel;
  const key = $("add-key").value.trim();

  if (!endpoint) {
    $("add-test-result").textContent = "Endpoint is required.";
    $("add-test-result").style.color = "var(--danger)";
    $("add-endpoint").focus();
    return;
  }

  const connection = {
    id: editingId || uid(),
    type: typeId,
    label,
    endpoint,
    model,
    key,
    enabled: true,
  };

  if (editingId) {
    const idx = state.settings.connections.findIndex((c) => c.id === editingId);
    if (idx >= 0) {
      connection.enabled = state.settings.connections[idx].enabled;
      state.settings.connections[idx] = connection;
    } else {
      state.settings.connections.push(connection);
    }
  } else {
    state.settings.connections.push(connection);
  }

  if (!state.settings.activeConnectionId || state.settings.activeConnectionId === "auto") {
    state.settings.activeConnectionId = connection.id;
  }
  saveSettings(state.settings);
  renderProvidersList();
  renderConnectionSelect();
  closeAddConnection();
}

async function testAddConnection() {
  const resultEl = $("add-test-result");
  const typeId = $("add-type").value;
  const t = typeById(typeId);
  const endpoint = $("add-endpoint").value.trim() || t.defaultEndpoint;
  if (!endpoint) {
    resultEl.textContent = "Endpoint is required.";
    resultEl.style.color = "var(--danger)";
    $("add-endpoint").focus();
    return;
  }
  resultEl.textContent = "Testing…";
  const connection = {
    id: "test",
    type: typeId,
    label: t.label,
    endpoint,
    model: $("add-model").value.trim() || t.defaultModel,
    key: $("add-key").value.trim(),
    enabled: true,
  };
  try {
    await callConnection(connection, [{ role: "user", content: "ping" }], null, new AbortController().signal);
    resultEl.textContent = "Connected";
    resultEl.style.color = "var(--ok)";
  } catch (e) {
    resultEl.textContent = "Failed: " + (e.message || e);
    resultEl.style.color = "var(--danger)";
  }
}

/* ---------- Add / edit agent ---------- */
function openAddAgent(existing = null) {
  const dlg = $("agent-dialog");
  const editingId = existing?.id || null;
  $("agent-form").dataset.editing = editingId || "";
  $("agent-title").textContent = editingId ? "Edit agent" : "Add agent";

  if (existing) {
    $("agent-label").value = existing.label || "";
    $("agent-prompt").value = existing.prompt || "";
    $("agent-tags").value = (existing.autoTags || []).join(", ");
  } else {
    $("agent-label").value = "";
    $("agent-prompt").value = "";
    $("agent-tags").value = "";
  }

  if (dlg.open) dlg.close();
  if (typeof dlg.showModal === "function") dlg.showModal();
  else {
    dlg.setAttribute("open", "");
    dlg.classList.add("dialog-open");
  }
}

function closeAddAgent() {
  try {
    const dlg = $("agent-dialog");
    dlg.close();
    dlg.classList.remove("dialog-open");
    dlg.removeAttribute("open");
  } catch {}
}

function saveAgentFromDialog() {
  const editingId = $("agent-form").dataset.editing || null;
  if (editingId && DEFAULT_AGENT_IDS.has(editingId)) {
    alert("Default agent prompts are fixed and cannot be edited.");
    closeAddAgent();
    return;
  }
  const label = $("agent-label").value.trim() || "Custom agent";
  const prompt = $("agent-prompt").value.trim();
  const tagsRaw = $("agent-tags").value.trim();
  const autoTags = tagsRaw ? tagsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];

  const agent = {
    id: editingId || uid(),
    label,
    prompt,
    enabled: true,
    autoTags,
  };

  if (editingId) {
    const idx = state.settings.agents.findIndex((a) => a.id === editingId);
    if (idx >= 0) {
      agent.enabled = state.settings.agents[idx].enabled;
      state.settings.agents[idx] = agent;
    } else {
      state.settings.agents.push(agent);
    }
  } else {
    state.settings.agents.push(agent);
  }

  if (!state.settings.activeAgentId || state.settings.activeAgentId === "auto") {
    state.settings.activeAgentId = agent.id;
  }
  saveSettings(state.settings);
  renderAgentsList();
  renderAgentSelect();
  closeAddAgent();
}

/* ---------- Import / Export ---------- */
function exportData() {
  const payload = {
    app: "chatai-pwa",
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    conversations: state.conversations,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `chatai-export-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function formatDate(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}

function chatTokens(conv) {
  return conv.messages?.reduce((sum, m) => sum + (m.usage?.total_tokens || 0), 0) || 0;
}

function generateHtmlExport(conv) {
  const total = chatTokens(conv);
  const title = escapeHtml(conv.title || "Chat");
  const parts = [
    "<!DOCTYPE html>",
    "<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>" + title + "</title>",
    "<style>",
    "body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;line-height:1.5;max-width:780px;margin:0 auto;padding:24px;color:#222;background:#fff}",
    "h1{font-size:28px;font-weight:700;border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:8px}",
    ".meta{color:#666;font-size:13px;margin-bottom:28px}",
    ".msg{margin:16px 0;padding:14px 16px;border-radius:12px;background:#f5f5f5}",
    ".msg.user{background:#e8f4ff}",
    ".msg.assistant{background:#f5f5f5}",
    ".role{font-weight:600;font-size:13px;color:#555;margin-bottom:6px}",
    ".tokens{font-size:12px;color:#888;margin-top:8px}",
    ".md-table{border-collapse:collapse;margin:12px 0;width:100%;font-size:15px;border:1px solid #ccc}",
    ".md-table td,.md-table th{border:1px solid #ccc;padding:8px 10px;text-align:left}",
    ".md-table th{background:#eee;font-weight:600}",
    ".md-list{margin:10px 0;padding-left:24px}",
    ".md-list li{margin:5px 0}",
    ".msg h2,.msg h3,.msg h4{margin:14px 0 8px;font-weight:700}",
    ".msg strong{font-weight:700}",
    ".msg em{font-style:italic}",
    "pre{background:#f0f0f0;padding:10px;border-radius:8px;overflow-x:auto;font-size:14px}",
    "code{background:#f0f0f0;padding:2px 5px;border-radius:4px;font-size:14px}",
    ".md-link{color:#0366d6;text-decoration:underline;cursor:default}",
    "</style>",
    "</head><body>",
    "<h1>" + title + "</h1>",
    "<div class='meta'>Exported: " + escapeHtml(new Date().toLocaleString()) + "</div>",
  ];
  for (const m of conv.messages || []) {
    const roleClass = m.role === "user" ? "user" : "assistant";
    const roleLabel = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
    let metaParts = [`${roleLabel} · ${formatDate(m.ts)}`];
    if (m.connection?.label || m.connection?.type) {
      metaParts.push(formatConnectionCredit(m.connection));
    }
    if (m.agent?.label) metaParts.push(m.agent.label);
    if (m.usage?.total_tokens) metaParts.push(`${m.usage.total_tokens.toLocaleString()} tokens`);
    const tokensHtml = metaParts.length > 2 ? `<div class='tokens'>${escapeHtml(metaParts.slice(1).join(" · "))}</div>` : "";

    let content = "";
    if (m.role === "assistant") {
      content = renderContent(m.content || "");
    } else {
      const text = escapeHtml(extractText(m.content) || "").replace(/\n/g, "<br>");
      const attHtml = (m.attachments || [])
        .map((att) => {
          if (att.kind === "image" && att.data) {
            return `<div class='attachment-chip'><img src="${att.data}" alt="${escapeHtml(att.name)}" style="width:28px;height:28px;object-fit:cover;border-radius:5px;"/><span class='file-name'>${escapeHtml(att.name)}</span></div>`;
          }
          const ext = att.name.split(".").pop()?.toUpperCase?.() || "FILE";
          return `<div class='attachment-chip'><span class='file-icon'>${ext.slice(0, 4)}</span><span class='file-name'>${escapeHtml(att.name)}</span></div>`;
        })
        .join("");
      content = text + (attHtml ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${attHtml}</div>` : "");
    }
    parts.push(`<div class='msg ${roleClass}'><div class='role'>${escapeHtml(metaParts[0])}</div>${content}${tokensHtml}</div>`);
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function exportChatAsHtml() {
  const conv = activeConv();
  if (!conv || !conv.messages?.length) {
    alert("No active chat to export.");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeTitle = (conv.title || "chat").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  const content = generateHtmlExport(conv);
  const blob = new Blob([content], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chatai-${safeTitle || "chat"}-${stamp}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== "object") throw new Error("Invalid file");
      let imported = 0;
      if (Array.isArray(data.conversations)) {
        for (const c of data.conversations) {
          if (!c.id) c.id = uid();
          if (!c.messages) c.messages = [];
          if (!c.title) c.title = "Imported chat";
          if (!c.createdAt) c.createdAt = nowTs();
          if (!c.updatedAt) c.updatedAt = nowTs();
          await dbPut(c);
          imported++;
        }
      }
      if (data.settings && typeof data.settings === "object") {
        let s = data.settings;
        if (!Array.isArray(s.connections) && (s.keys || s.endpoints || s.models)) {
          s = {
            activeConnectionId: "auto",
            activeAgentId: "auto",
            connections: migrateOldConnections(s),
            agents: mergeAgents([]),
          };
          if (data.settings.systemPrompt?.trim()) {
            s.agents = mergeAgents([]);
            s.agents.push({
              id: uid(),
              label: "Imported system prompt",
              prompt: data.settings.systemPrompt.trim(),
              enabled: true,
              autoTags: ["chat", "general"],
            });
          } else {
            s.agents = mergeAgents(s.agents);
          }
        }
        state.settings = {
          activeConnectionId: s.activeConnectionId || "auto",
          activeAgentId: s.activeAgentId || "auto",
          connections: Array.isArray(s.connections) ? s.connections : [],
          agents: mergeAgents(s.agents),
        };
        saveSettings(state.settings);
      }
      state.conversations = await dbAll();
      state.activeId = state.conversations[0]?.id || null;
      renderChatList();
      renderMessages();
      renderConnectionSelect();
      renderAgentSelect();
      alert(`Imported ${imported} conversation(s) and settings.`);
    } catch (e) {
      alert("Import failed: " + (e.message || e));
    }
  };
  reader.readAsText(file);
}

/* ---------- Offline indicator ---------- */
function updateNetStatus() {
  const online = navigator.onLine;
  netStatusEl.title = "Network status: " + (online ? "online" : "offline");
  netStatusEl.setAttribute("aria-label", "Network status: " + (online ? "online" : "offline"));
  netStatusEl.className = "icon-btn " + (online ? "status-online" : "status-offline");
}

/* ---------- Service worker ---------- */
if ("serviceWorker" in navigator) {
  // Reload once when a newly-installed service worker takes control, so users
  // always run the latest app shell instead of being stuck on a stale cached
  // bundle. Guarded by sessionStorage to prevent a reload loop.
  let swReloaded = sessionStorage.getItem("sw-reloaded") === "1";
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swReloaded) return;
      swReloaded = true;
      sessionStorage.setItem("sw-reloaded", "1");
      location.reload();
    });
  });
}

/* ---------- Input auto-grow ---------- */
function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

let voiceFinalText = "";
let voiceLastInterim = "";

function isVoiceRecording() {
  return !!(speechRecognizer || (voiceRecorder && voiceRecorder.state !== "inactive"));
}

function setVoiceRecordingUI(recording, interim = "") {
  if (!voiceRecordingBar || !inputEl) return;
  voiceRecordingBar.hidden = !recording;
  inputEl.hidden = recording;
  if (voiceBtn) {
    voiceBtn.classList.toggle("recording", recording);
    voiceBtn.title = recording ? "Stop recording" : "Start voice recording";
    voiceBtn.setAttribute("aria-label", recording ? "Stop recording" : "Start voice recording");
  }
  if (recording) {
    if (voiceRecordingText) {
      const text = (voiceFinalText + " " + interim).trim();
      voiceRecordingText.textContent = text || "Listening…";
    }
    voiceRecordingBar.classList.toggle("has-text", !!interim || !!voiceFinalText);
  }
}

function stopVoiceInput() {
  if (speechRecognizer) {
    try { speechRecognizer.stop(); } catch {}
    speechRecognizer = null;
  }
  if (voiceRecorder && voiceRecorder.state !== "inactive") {
    try { voiceRecorder.stop(); } catch {}
  }
  voiceFinalText = "";
  voiceLastInterim = "";
  setVoiceRecordingUI(false);
}

function onVoiceResult({ final, interim }) {
  voiceFinalText = final;
  voiceLastInterim = interim;
  setVoiceRecordingUI(true, interim);
}

function onVoiceEnd() {
  const text = voiceFinalText.trim();
  voiceFinalText = "";
  voiceLastInterim = "";
  setVoiceRecordingUI(false);
  inputEl.value = text;
  autoGrow();
  if (text) sendMessage();
}

async function startVoiceRecording() {
  if (isVoiceRecording()) return;
  // Prefer Web Speech API if enabled in settings and available.
  const useWebSpeech = state.settings.voiceInputProvider === "web-speech" || !state.settings.voiceInputProvider;
  if (useWebSpeech && isSpeechRecognitionSupported()) {
    voiceFinalText = "";
    voiceLastInterim = "";
    speechRecognizer = createSpeechRecognizer({
      lang: state.settings.ttsLang || "en-US",
      onResult: onVoiceResult,
      onError: (err) => {
        console.error("voice recognition error", err);
        appendMessageEl({ role: "error", content: `Voice recognition error: ${err.message || err}` });
        stopVoiceInput();
      },
      onEnd: onVoiceEnd,
    });
    try {
      speechRecognizer.start();
      setVoiceRecordingUI(true, "");
    } catch (e) {
      console.error("voice recording failed", e);
      appendMessageEl({ role: "error", content: `Voice recording failed: ${e.message || e}` });
      stopVoiceInput();
    }
    return;
  }

  // Fallback: MediaRecorder + Whisper-compatible provider.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    const mediaRecorder = new MediaRecorder(stream);
    voiceRecorder = mediaRecorder;
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(voiceChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      setVoiceRecordingUI(false);
      if (blob.size === 0) return;
      try {
        const transcript = await transcribeAudio(blob, state.settings, state.settings.connections || [], new AbortController().signal);
        inputEl.value = transcript.trim();
        autoGrow();
        if (inputEl.value.trim()) sendMessage();
      } catch (e) {
        console.error("whisper transcription failed", e);
        appendMessageEl({ role: "error", content: `Voice transcription failed: ${e.message || e}` });
      }
    };
    mediaRecorder.start();
    setVoiceRecordingUI(true, "");
  } catch (e) {
    console.error("voice recording failed", e);
    appendMessageEl({ role: "error", content: `Voice recording failed: ${e.message || e}` });
    setVoiceRecordingUI(false);
  }
}

function toggleVoiceRecording(e) {
  if (e) e.preventDefault();
  if (isVoiceRecording()) stopVoiceInput();
  else startVoiceRecording();
}

function closeSidebarMobile() {
  if (sidebarEl && window.matchMedia("(max-width: 720px)").matches) sidebarEl.dataset.open = "false";
}

/* ---------- Online / sidebar / credit UI ---------- */
function toggleSidebar() {
  sidebarEl.dataset.open = sidebarEl.dataset.open === "true" ? "false" : "true";
}

/* ---------- Resizable sidebar ---------- */
function getSidebarWidth() {
  const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  if (Number.isFinite(saved)) return Math.min(Math.max(saved, SIDEBAR_MIN), SIDEBAR_MAX);
  return 300;
}

function setSidebarWidth(w) {
  const max = Math.min(SIDEBAR_MAX, window.innerWidth * 0.5);
  const clamped = Math.min(Math.max(w, SIDEBAR_MIN), max);
  document.documentElement.style.setProperty("--sidebar-w", clamped + "px");
  return clamped;
}

// Drag-to-resize on the sidebar handle. Desktop only — on mobile the sidebar
// is an overlay with a fixed width, so resizing is disabled there. The
// persisted width is applied earlier in init() before the first render.
function initSidebarResize() {
  if (!sidebarEl || !sidebarHandleEl) return;
  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;

  let resizing = false;
  let startX = 0;
  let startW = 0;

  sidebarHandleEl.addEventListener("pointerdown", (e) => {
    if (isMobile()) return;
    if (sidebarEl.dataset.open !== "true") return; // only resize while open
    resizing = true;
    sidebarDidDrag = false;
    startX = e.clientX;
    startW = parseFloat(getComputedStyle(sidebarEl).width) || 300;
    sidebarEl.classList.add("resizing");
    document.body.classList.add("resizing");
    try { sidebarHandleEl.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  sidebarHandleEl.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const dx = startX - e.clientX;
    if (Math.abs(dx) > 4) sidebarDidDrag = true;
    setSidebarWidth(startW + dx);
  });

  const endResize = (e) => {
    if (!resizing) return;
    resizing = false;
    sidebarEl.classList.remove("resizing");
    document.body.classList.remove("resizing");
    try { sidebarHandleEl.releasePointerCapture(e.pointerId); } catch {}
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(parseFloat(getComputedStyle(sidebarEl).width)));
  };
  sidebarHandleEl.addEventListener("pointerup", endResize);
  sidebarHandleEl.addEventListener("pointercancel", endResize);
}

function toggleOnline() {
  state.settings.onlineMode = !state.settings.onlineMode;
  saveSettings(state.settings);
  renderOnlineButton();
  updateComposerForOnline();
}

function renderOnlineButton() {
  const on = state.settings.onlineMode;
  if (onlineBtnEl) {
    onlineBtnEl.classList.toggle("online-on", on);
    onlineBtnEl.classList.toggle("online-off", !on);
    onlineBtnEl.title = on ? "Online mode: on" : "Online mode: off";
    onlineBtnEl.setAttribute("aria-label", on ? "Online mode is on" : "Online mode is off");
  }
}

function getActiveConnection() {
  const connId = state.settings.activeConnectionId;
  if (connId === "auto") {
    const conns = chatConnections(state.settings);
    return conns[0] || null;
  }
  return (state.settings.connections || []).find((c) => c.id === connId) || null;
}

function updateComposerPlaceholder() {
  if (!inputEl) return;
  const activeConnection = getActiveConnection();
  const hasOfflineCapable = activeConnection?.type === "webllm" && isModelInstalled(activeConnection.modelId);

  if (!state.settings.onlineMode && !hasOfflineCapable) {
    inputEl.placeholder = "Offline mode — enable Online to send";
  } else if (!state.settings.onlineMode && hasOfflineCapable) {
    inputEl.placeholder = "Message… (using offline model)";
  } else {
    inputEl.placeholder = "Message… (Enter to send, Shift+Enter for newline)";
  }
}

function updateComposerForOnline() {
  if (!inputEl) return;
  const activeConnection = getActiveConnection();
  const hasOfflineCapable = activeConnection?.type === "webllm" && isModelInstalled(activeConnection.modelId);
  inputEl.disabled = !state.settings.onlineMode && !hasOfflineCapable;
  updateComposerPlaceholder();
}

function chatUsage(conv) {
  return (conv?.messages || []).reduce((sum, m) => sum + (m.usage?.total_tokens || 0), 0);
}

function lastAssistantMessage(conv) {
  if (!conv?.messages) return null;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === "assistant") return conv.messages[i];
  }
  return null;
}


/* ---------- Theme toggle ---------- */
function initThemeToggle() {
  const toggle = document.querySelector(".theme-toggle");
  if (!toggle) return;
  const icon = toggle.querySelector(".theme-toggle-icon");
  const html = document.documentElement;
  function updateToggle(theme) {
    const isDark = theme === "dark";
    toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    toggle.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
    if (icon) {
      icon.innerHTML = isDark
        ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }
  updateToggle(html.getAttribute("data-theme") || "light");
  toggle.addEventListener("click", () => {
    const current = html.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateToggle(next);
  });
}

/* ---------- Init ---------- */
async function init() {
  // Apply the persisted sidebar width before the first render so the panel
  // doesn't flash at the default 300px. Desktop only.
  if (sidebarEl && !window.matchMedia("(max-width: 720px)").matches) {
    setSidebarWidth(getSidebarWidth());
  }
  state.conversations = await dbAll();
  if (state.conversations.length === 0) {
    await newConv();
  } else {
    state.activeId = state.conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  }
  renderChatList();
  renderMessages();
  renderConnectionSelect();
  renderAgentSelect();
  renderOnlineButton();
  updateComposerForOnline();
  updateNetStatus();
  initThemeToggle();

  // Handle PWA shortcuts from the manifest (e.g. ?action=new, ?action=settings).
  const urlAction = new URLSearchParams(location.search).get("action");
  if (urlAction === "new") {
    clearAttachments();
    await newConv();
  } else if (urlAction === "settings") {
    openSettings();
  }
  if (urlAction) {
    try { history.replaceState({}, "", location.pathname + location.hash); } catch {}
  }

  // Composer: Enter sends, Shift+Enter for newline; send button also works.
  if (inputEl) {
    inputEl.addEventListener("input", autoGrow);
    inputEl.addEventListener("paste", onPaste);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }
  if (composerEl) composerEl.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(); });
  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  if (stopBtn) stopBtn.addEventListener("click", () => { if (state.streaming) stopStreaming(); });

  if (attachBtn && fileInputEl) {
    attachBtn.addEventListener("click", () => fileInputEl.click());
    fileInputEl.addEventListener("change", onFileSelect);
  }
  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      if (state.streaming) return;
      toggleVoiceRecording();
    });
  }
  if (stopVoiceBtn) stopVoiceBtn.addEventListener("click", () => toggleVoiceRecording());
  if (connectionSelectEl) connectionSelectEl.addEventListener("change", onConnectionSelectChange);
  if (modelSelectEl) modelSelectEl.addEventListener("change", onModelSelectChange);
  if (agentSelectEl) agentSelectEl.addEventListener("change", onAgentSelectChange);
  // Composer model-list refresh — bypass the cache so newly-pulled Ollama
  // models show up without a reload.
  const refreshModelSelectBtn = $("btn-refresh-model-select");
  if (refreshModelSelectBtn) {
    refreshModelSelectBtn.addEventListener("click", async () => {
      const conn = activeConnection(state.settings);
      if (!conn) return;
      const base = ollamaBaseUrl(conn.endpoint);
      if (base) ollamaModelsCache.delete(base);
      await renderModelSelect();
    });
  }

  // Sidebar
  let newConvGuard = false;
  const newBtn = $("btn-new");
  if (newBtn) {
    newBtn.addEventListener("click", async () => {
      if (newConvGuard) return;
      newConvGuard = true;
      try {
        clearAttachments();
        await newConv();
        closeSidebarMobile();
      } finally {
        newConvGuard = false;
      }
    });
  }
  if (sidebarHandleEl) {
    sidebarHandleEl.addEventListener("click", (e) => {
      if (sidebarDidDrag) { sidebarDidDrag = false; return; } // a drag, not a click
      toggleSidebar();
    });
  }
  initSidebarResize();

  // Topbar actions
  const settingsBtn = $("btn-settings");
  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
  const importBtn = $("btn-import");
  if (importBtn) importBtn.onclick = () => $("file-import")?.click();
  const exportBtn = $("btn-export");
  if (exportBtn) exportBtn.onclick = exportData;
  if (exportChatBtn) {
    exportChatBtn.addEventListener("click", exportChatAsHtml);
  }
  if (onlineBtnEl) onlineBtnEl.addEventListener("click", toggleOnline);
  const fileImportEl = $("file-import");
  if (fileImportEl) {
    fileImportEl.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importData(f);
      e.target.value = "";
    });
  }
  const searchEl = $("search");
  if (searchEl) searchEl.addEventListener("input", renderChatList);

  // Settings dialog
  const settingsDlg = $("settings-dialog");
  if (!settingsDlg) throw new Error("Required #settings-dialog element is missing from the page");
  const closeBtn = $("btn-close");
  if (closeBtn) closeBtn.onclick = () => closeSettings();
  // AI Providers - unified add-model button (offline + API)
  const addModelBtn = $("btn-add-model");
  if (addModelBtn) {
    addModelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openAddModelDialog("offline");
    });
  }
  const addAgentBtn = $("btn-add-agent");
  if (addAgentBtn) addAgentBtn.onclick = () => openAddAgent();

  // Unified add-model dialog close button
  const addModelCloseBtn = $("btn-add-model-close");
  if (addModelCloseBtn) addModelCloseBtn.onclick = () => closeAddModelDialog();
  // Close dialog on click outside
  if (addModelDialog) {
    addModelDialog.addEventListener("click", (e) => {
      if (e.target === addModelDialog) closeAddModelDialog();
    });
  }
  // Tab switcher for the unified add-model dialog
  const tabOfflineBtn = $("tab-btn-offline");
  if (tabOfflineBtn) tabOfflineBtn.addEventListener("click", () => switchAddModelTab("offline"));
  const tabApiBtn = $("tab-btn-api");
  if (tabApiBtn) tabApiBtn.addEventListener("click", () => switchAddModelTab("api"));
  const settingsForm = $("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveSettings(state.settings);
      closeSettings();
    });
  }
  settingsDlg.addEventListener("click", (e) => {
    if (e.target === settingsDlg) closeSettings();
  });
  if (settingsDlg.open) closeSettings();
  settingsDlg.classList.remove("dialog-open");

  // Add-connection dialog (API tab of the unified add-model dialog)
  const addDlg = $("add-model-dialog");
  if (!addDlg) throw new Error("Required #add-model-dialog element is missing from the page");
  const addCloseBtn = $("btn-add-close");
  if (addCloseBtn) addCloseBtn.onclick = () => closeAddConnection();
  const addTestBtn = $("btn-add-test");
  if (addTestBtn) addTestBtn.onclick = (e) => { e.preventDefault(); testAddConnection(); };
  const addForm = $("add-form");
  if (addForm) {
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveConnectionFromDialog();
    });
  }
  // Re-fetch the Ollama model list when the endpoint changes or the refresh
  // button is clicked. refreshOllamaModelList() self-guards to the ollama type.
  const addEndpointInput = $("add-endpoint");
  if (addEndpointInput) {
    addEndpointInput.addEventListener("change", () => refreshOllamaModelList());
  }
  const refreshModelsBtn = $("btn-refresh-models");
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      refreshOllamaModelList();
    });
  }
  const syncLoadedBtn = $("btn-sync-loaded-model");
  if (syncLoadedBtn) {
    syncLoadedBtn.addEventListener("click", (e) => {
      e.preventDefault();
      syncOllamaLoadedModel();
    });
  }
  addDlg.addEventListener("click", (e) => {
    if (e.target === addDlg) closeAddConnection();
  });
  if (addDlg.open) closeAddConnection();
  addDlg.classList.remove("dialog-open");

  // Add-agent dialog
  const agentDlg = $("agent-dialog");
  if (!agentDlg) throw new Error("Required #agent-dialog element is missing from the page");
  const agentCloseBtn = $("btn-agent-close");
  if (agentCloseBtn) agentCloseBtn.onclick = () => closeAddAgent();
  const agentForm = $("agent-form");
  if (agentForm) {
    agentForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveAgentFromDialog();
    });
  }
  agentDlg.addEventListener("click", (e) => {
    if (e.target === agentDlg) closeAddAgent();
  });
  if (agentDlg.open) closeAddAgent();
  agentDlg.classList.remove("dialog-open");

  // Network status
  window.addEventListener("online", updateNetStatus);
  window.addEventListener("offline", updateNetStatus);

}

init().catch((e) => {
  console.error("init failed", e);
  const el = document.createElement("div");
  el.className = "empty-hint";
  el.textContent = "Failed to initialize: " + (e.message || e);
  messagesEl.appendChild(el);
});
