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
import { FileSystemManager, isFileSystemAccessSupported } from "./fs-tools.js";
import { buildFolderSystemPrompt, runAgentLoop, parseToolCalls } from "./agent-loop.js";
import { buildBrowserSystemPrompt, runBrowserAgentLoop } from "./browser-agent.js";
import { openDB, CONVERSATIONS_STORE as STORE } from "./db.js";
import { generateImage, searchWeb, fetchUrlText } from "./tools.js";
import { extractTextFromFile, getDocumentExtension } from "./doc-parser.js";
import { addFileToKnowledgeBase, removeFileFromKnowledgeBase, getKnowledgeBaseFiles, embedQuery, searchKnowledgeBase, formatKBContext, kbClear } from "./rag.js";
import { getMemoryContext, rememberFromMessage } from "./memory.js";
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

function resetSessionUsage() {
  saveSessionUsage(0);
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

const OBSOLETE_AGENT_IDS = new Set(["agent_code_folder", "agent_write_folder", "agent_research_folder"]);

function isObsoleteAgent(a) {
  if (!a) return true;
  if (OBSOLETE_AGENT_IDS.has(a.id)) return true;
  if (typeof a.label === "string" && a.label.toLowerCase().includes("(folder)")) return true;
  return false;
}

// Merge saved agents with the canonical default agents. Default agents are always
// restored with their original prompts; only their enabled state is preserved.
// Custom agents (IDs not in DEFAULT_AGENT_IDS) are kept as-is.
function mergeAgents(savedAgents) {
  const custom = (savedAgents || []).filter((a) => a && !DEFAULT_AGENT_IDS.has(a.id) && !isObsoleteAgent(a));
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
  browserMode: false,
  browserHistory: [],
  browserHistoryIndex: -1,
};

const fs = new FileSystemManager();
let fileTreeCache = [];
let activeFilePath = null;

let pendingAttachments = [];
let voiceRecorder = null; // MediaRecorder instance
let voiceChunks = []; // blob chunks for Whisper fallback
let speechRecognizer = null; // Web Speech API recognizer

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const chatListEl = $("chat-list");
const inputEl = $("input");
const composerEl = $("composer");
const stopBtn = $("btn-stop");
const sendBtn = $("btn-send");
const attachBtn = $("btn-attach");
const linkFolderBtn = $("btn-link-folder");
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
const agentSelectEl = $("agent-select");
const exportChatBtn = $("btn-export-chat");
const readmeBtn = $("btn-readme");
const techDocBtn = $("btn-tech-doc");
const contactBtn = $("btn-contact");
const projectPanel = $("project-panel");
const projectNameEl = $("project-name");
const fileTreeEl = $("file-tree");
const refreshFolderBtn = $("btn-refresh-folder");
const disconnectFolderBtn = $("btn-disconnect-folder");
const fsaBanner = $("fsa-banner");
const previewDialog = $("preview-dialog");
const previewTitle = $("preview-title");
const previewContent = $("preview-content");
const previewCloseBtn = $("btn-preview-close");
const linkDialog = $("link-dialog");
const linkCloseBtn = $("btn-link-close");
const linkFolderChoiceBtn = $("btn-link-folder-choice");
const linkFileChoiceBtn = $("btn-link-file-choice");

const browserBtn = $("btn-browser");
const browserView = $("browser-view");
const browserIframe = $("browser-iframe");
const browserUrlInput = $("browser-url");
const browserGoBtn = $("btn-browser-go");
const browserBackBtn = $("btn-browser-back");
const browserForwardBtn = $("btn-browser-forward");
const browserRefreshBtn = $("btn-browser-refresh");
const browserPlaceholder = $("browser-placeholder");
const browserStartInput = $("browser-start-input");
const browserStartGoBtn = $("btn-browser-start-go");
const splitHandle = $("split-handle");

const kbFileInput = $("kb-file-input");
const kbListEl = $("kb-list");
const addKbBtn = $("btn-add-kb");
const ragEmbeddingProviderEl = $("rag-embedding-provider");
const ragTopKEl = $("rag-top-k");
const ragChunkSizeEl = $("rag-chunk-size");
const ragChunkOverlapEl = $("rag-chunk-overlap");

const ttsProviderEl = $("tts-provider");
const ttsLangEl = $("tts-lang");
const ttsRateEl = $("tts-rate");
const ttsPitchEl = $("tts-pitch");
const voiceInputProviderEl = $("voice-input-provider");

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
  let visibleIndex = 1;
  for (const m of conv.messages) {
    if (!m.hidden) appendMessageEl(m, visibleIndex++);
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
  const hasLink = fs.connected;
  if (!hasAttachments && !hasLink) {
    attachmentPreviewEl.hidden = true;
    return;
  }
  attachmentPreviewEl.hidden = false;
  if (hasLink) {
    attachmentPreviewEl.appendChild(renderLinkedChip());
  }
  for (const att of pendingAttachments) {
    attachmentPreviewEl.appendChild(renderAttachmentChip(att, true));
  }
}

function renderLinkedChip() {
  const chip = document.createElement("div");
  chip.className = "linked-chip";
  chip.title = fs.mode === "file" ? `Linked file: ${fs.filePath}` : `Linked folder: ${fs.name}`;
  chip.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <circle cx="17" cy="13" r="2.5" fill="currentColor" stroke="none"/>
    </svg>
  `;
  const name = document.createElement("span");
  name.className = "link-name";
  name.textContent = fs.mode === "file" ? fs.filePath : fs.name || "project";
  chip.appendChild(name);

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.title = "Disconnect linked location";
  remove.setAttribute("aria-label", "Disconnect linked location");
  remove.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`;
  remove.onclick = () => { disconnectFolder(); };
  chip.appendChild(remove);
  return chip;
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

    // Render page text as a collapsible section (browser agent results)
    if (m.pageText) {
      const pageDetails = document.createElement("details");
      pageDetails.className = "tool-block tool-navigate";
      pageDetails.open = true;
      const pageSummary = document.createElement("summary");
      pageSummary.textContent = `📄 Page: ${m.pageTitle || m.pageUrl || "Page content"}`;
      const pageBody = document.createElement("div");
      pageBody.className = "tool-body";
      pageBody.textContent = m.pageText;
      pageDetails.append(pageSummary, pageBody);
      el.appendChild(pageDetails);
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

  if (enabled.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No connection — add in Settings";
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
    return;
  }

  const current = state.settings.activeConnectionId || "auto";
  if (current === "auto" || enabled.some((c) => c.id === current)) {
    autoOpt.selected = current === "auto";
  }

  for (const c of enabled) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = formatConnectionCredit(c);
    if (c.id === current) o.selected = true;
    sel.appendChild(o);
  }
}

// Agents that only make sense when a folder or file is linked.
const LINK_ONLY_AGENT_IDS = new Set(["agent_code", "agent_pwa", "agent_image"]);

function renderAgentSelect() {
  const sel = agentSelectEl;
  const enabled = enabledAgents(state.settings);
  sel.innerHTML = "";

  const hasAutoAgent = enabled.some((a) => a.id === "agent_auto");

  // When a folder/file is linked, we show coding/PWA agents plus the always-usable Auto agent.
  // Other generic agents (minimal, bullet, table, research, max) are hidden because every
  // linked question is automatically routed through the folder-aware agent loop.
  const linked = fs.connected;
  const visible = enabled.filter((a) => {
    if (LINK_ONLY_AGENT_IDS.has(a.id)) return linked;
    return !linked || a.id === "agent_auto";
  });

  // Only add the system-level "auto" option when there is no Auto agent preset,
  // so the dropdown never shows "Auto agent" twice.
  let autoOpt = null;
  if (!hasAutoAgent) {
    autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto agent";
    sel.appendChild(autoOpt);
  }

  if (visible.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = linked ? "No linked agent" : "No agent";
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
    return;
  }

  let current = state.settings.activeAgentId || "auto";
  if (current === "auto" && hasAutoAgent) current = "agent_auto";

  // If the previously selected agent is now hidden, fall back to the Auto agent.
  if (!visible.some((a) => a.id === current)) {
    current = visible.some((a) => a.id === "agent_auto") ? "agent_auto" : (visible[0]?.id || "auto");
    if (state.settings.activeAgentId !== current) {
      state.settings.activeAgentId = current;
      saveSettings(state.settings);
    }
  }

  if (autoOpt && (current === "auto" || !visible.some((a) => a.id === current))) {
    autoOpt.selected = true;
  }

  for (const a of visible) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.label || "Agent";
    if (a.id === current) o.selected = true;
    sel.appendChild(o);
  }
}

function onConnectionSelectChange() {
  const id = connectionSelectEl.value;
  if (!id) return;
  state.settings.activeConnectionId = id;
  saveSettings(state.settings);
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
  if (agentTags.has("write") || /\b(write|draft|essay|email|letter|article|blog|story)\b/.test(lower)) return "write";
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

async function runFolderFlow(conv, text, agent, connection, signal) {
  state.streamingEl = document.createElement("div");
  state.streamingEl.className = "msg assistant streaming";
  state.streamingEl.innerHTML = '<span class="stream-cursor">▋</span>';
  messagesEl.appendChild(state.streamingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const memoryContext = await getMemoryContext({ query: text, convId: conv.id, agentId: agent?.id, limit: 5 });

  let streamedFinal = "";
  const onToken = (delta, full) => {
    streamedFinal = full;
    if (state.streamingEl) {
      state.streamingEl.innerHTML = renderContent(full) + '<span class="stream-cursor">▋</span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  };

  const { final, actions, usage } = await runFolderAgentLoop(connection, conv.messages, agent, signal, memoryContext, onToken);
  await refreshFolder();
  return {
    role: "assistant",
    content: final,
    usage,
    connection: { id: connection.id, type: connection.type, label: connection.label || typeById(connection.type)?.label || connection.type, model: connection.model },
    agent: agent ? { id: agent.id, label: agent.label } : null,
    ts: nowTs(),
  };
}

async function runBrowserFlow(conv, text, agent, connection, signal) {
  state.streamingEl = document.createElement("div");
  state.streamingEl.className = "msg assistant streaming";
  state.streamingEl.innerHTML = '<span class="stream-cursor">▋</span>';
  messagesEl.appendChild(state.streamingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const memoryContext = await getMemoryContext({ query: text, convId: conv.id, agentId: agent?.id, limit: 5 });

  let streamedFinal = "";
  const onToken = (delta, full) => {
    streamedFinal = full;
    if (state.streamingEl) {
      state.streamingEl.innerHTML = renderContent(full) + '<span class="stream-cursor">▋</span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  };

  // Build browser state with iframe navigation callback
  const browserState = {
    currentUrl: browserIframe.src || null,
    lastFetchedUrl: null,
    pageText: null,
    pageLinks: [],
    pageForms: [],
    pageSections: [],
    pageTitle: null,
    pendingFormData: null,
    navigateIframe: (url) => {
      browserPlaceholder.hidden = true;
      browserIframe.src = url;
      browserUrlInput.value = url;
      // Update browser history
      if (state.browserHistoryIndex < state.browserHistory.length - 1) {
        state.browserHistory = state.browserHistory.slice(0, state.browserHistoryIndex + 1);
      }
      state.browserHistory.push(url);
      state.browserHistoryIndex = state.browserHistory.length - 1;
      updateBrowserNavButtons();
    },
  };

  const agentPrompt = agent?.prompt || "";
  const systemPrompt = buildBrowserSystemPrompt(agentPrompt, memoryContext);

  const progressEl = document.createElement("div");
  progressEl.className = "agent-progress";
  progressEl.innerHTML = '<span class="spinner"></span> <span>Browser agent is working…</span>';
  messagesEl.appendChild(progressEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const { final, actions, usage } = await runBrowserAgentLoop({
      callConnection,
      connection,
      messages: conv.messages,
      systemPrompt,
      signal,
      browserState,
      onProgress: (ev) => {
        if (typeof ev === "object" && ev.type) {
          appendBrowserToolBlock(ev.type, ev);
        }
      },
      onToken,
    });
    return {
      role: "assistant",
      content: final,
      usage,
      connection: { id: connection.id, type: connection.type, label: connection.label || typeById(connection.type)?.label || connection.type, model: connection.model },
      agent: agent ? { id: agent.id, label: agent.label } : null,
      ts: nowTs(),
      pageText: browserState.pageText ? browserState.pageText.slice(0, 5000) : null,
      pageUrl: browserState.currentUrl,
      pageTitle: browserState.pageTitle,
    };
  } finally {
    progressEl.remove();
  }
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

    if (!state.settings.onlineMode) {
      const err = { role: "error", content: "Offline mode is on. Enable Online to send AI requests.", ts: nowTs() };
      conv.messages.push(err);
      appendMessageEl(err);
      await persistConv(conv);
      return;
    }

    const budget = state.settings.creditBudget;
    if (budget > 0 && state.sessionTokens >= budget) {
      const err = { role: "error", content: `Session token budget exceeded (${state.sessionTokens.toLocaleString()} / ${budget.toLocaleString()}). Raise the budget in Settings to continue.`, ts: nowTs() };
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
      if (state.browserMode) {
        typingEl.remove();
        result = await runBrowserFlow(conv, text, agent, connection, state.abortCtrl.signal);
        if (result.usage?.total_tokens) {
          state.sessionTokens = addSessionUsage(result.usage.total_tokens);
          renderChatList();
        }
      } else if (route.type === "image") {
        typingEl.remove();
        await runImageFlow(conv, text, route.connection, state.abortCtrl.signal);
      } else if (route.type === "search") {
        typingEl.remove();
        await runSearchFlow(conv, text, agent, route.connection, connection, state.abortCtrl.signal);
      } else if (route.type === "kb") {
        typingEl.remove();
        await runKBFlow(conv, text, agent, route.connection, connection, state.abortCtrl.signal);
      } else if (fs.connected) {
        typingEl.remove();
        // When a folder/file is linked, route coding/PWA agents through the folder-aware
        // agent loop. Other agents (including Auto) run the same loop so they can use tools.
        result = await runFolderFlow(conv, text, agent, connection, state.abortCtrl.signal);
        if (result.usage?.total_tokens) {
          state.sessionTokens = addSessionUsage(result.usage.total_tokens);
          renderChatList();
        }
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
  if (!connection.endpoint) throw new Error("No endpoint configured");
  if (!connection.model && !type?.defaultModel) throw new Error("No model configured");

  const messages = buildMessages(connection, history, agent);
  return callModel({ connection, messages, signal, options });
}

function stopStreaming() {
  if (state.abortCtrl) state.abortCtrl.abort();
}

async function runFolderAgentLoop(connection, messages, agent, signal, memoryContext = "") {
  let agentPrompt = agent?.prompt || "";
  // All agents become folder-aware automatically while a folder or file is linked.
  agentPrompt = agentPrompt + "\n\nA folder or file is currently linked to this chat. When the user's request involves that location, you MUST use the file tools (list_dir, read_file, write_file, apply_patch, search_files) to act on it. Do not refuse, ask permission, or claim you cannot access local files — the user has already granted access.";
  if (memoryContext?.trim()) {
    agentPrompt = agentPrompt + "\n\n" + memoryContext.trim();
  }
  const toolConfig = buildAgentToolConfig();
  const systemPrompt = buildFolderSystemPrompt(agentPrompt, fs.name, fs.filePath, toolConfig);
  const progressEl = document.createElement("div");
  progressEl.className = "agent-progress";
  progressEl.innerHTML = `<span class="spinner"></span> <span>Agent is reading/writing files…</span>`;
  messagesEl.appendChild(progressEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    return await runAgentLoop({
      fs,
      callConnection,
      connection,
      messages,
      systemPrompt,
      signal,
      toolConfig,
      onProgress: (ev) => {
        if (typeof ev === "object" && ev.type) {
          appendToolBlock(ev.type, ev);
        }
      },
    });
  } finally {
    progressEl.remove();
  }
}

function buildAgentToolConfig() {
  const cfg = {};
  const web = findEnabledConnection(["tavily", "brave_search", "serpapi"]);
  if (web) cfg.webSearch = web;
  const img = findEnabledConnection(["dalle", "stability"]);
  if (img) cfg.imageGen = img;
  cfg.fetchUrl = true;
  const emb = state.settings.ragEnabled && state.settings.ragEmbeddingProvider
    ? findEnabledConnection([state.settings.ragEmbeddingProvider])
    : null;
  if (emb) cfg.kbSearch = { connection: emb, topK: state.settings.ragTopK };
  return cfg;
}

function appendToolBlock(type, data) {
  const summaryMap = {
    list: `list ${data.path}`,
    read: `read ${data.path}`,
    write: `write ${data.path}`,
    patch: `patch ${data.path}`,
    search: `search "${data.query}" (${data.count} hits)`,
    web_search: `web search "${data.query}"`,
    generate_image: `generate image`,
    fetch_url: `fetch ${data.url}`,
    read_kb: `knowledge base "${data.query}"`,
  };
  const details = document.createElement("details");
  details.className = `tool-block tool-${type}`;
  details.open = false;
  const summary = document.createElement("summary");
  summary.textContent = summaryMap[type] || type;
  const body = document.createElement("div");
  body.className = "tool-body";
  if (type === "list") body.textContent = data.entries ? formatListText(data.entries) : "";
  else if (type === "read") body.textContent = data.snippet ? data.snippet : `read ${data.path}`;
  else if (type === "write") body.textContent = data.content ? data.content.slice(0, 1200) : `wrote ${data.path}`;
  else if (type === "patch") body.textContent = `patched ${data.path}`;
  else if (type === "search") body.textContent = data.hits ? formatSearchText(data.hits) : `search "${data.query}"`;
  else if (type === "web_search") body.textContent = `${data.count || 0} results`;
  else if (type === "generate_image") {
    const url = data.url || "";
    if (/^(https?:|data:image\/)/i.test(url)) {
      body.innerHTML = `<img src="${escapeHtml(url)}" alt="generated" class="generated-image" />`;
    } else {
      body.textContent = "Image URL not displayed: unsupported scheme";
    }
  }
  else if (type === "fetch_url") body.textContent = `fetched ${data.length || 0} chars`;
  else if (type === "read_kb") body.textContent = `${data.count || 0} excerpts`;
  details.append(summary, body);
  messagesEl.appendChild(details);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendBrowserToolBlock(type, data) {
  const summaryMap = {
    navigate: `navigate to ${data.url}`,
    get_page_text: `get page text (${data.length || 0} chars)${data.cached ? ' [cached]' : ''}`,
    extract_links: `extract links (${data.count || 0} found)${data.cached ? ' [cached]' : ''}`,
    extract_forms: `extract forms (${data.count || 0} found)${data.cached ? ' [cached]' : ''}`,
    get_page_structure: `get page structure (${data.count || 0} sections)${data.cached ? ' [cached]' : ''}`,
    click_link: `click link → ${data.url}`,
    fill_form: `fill "${data.field}"`,
    submit_form: `submit form to ${data.url}`,
    thinking: `thinking (iteration ${data.iteration}/${data.maxIterations})`,
  };
  const details = document.createElement("details");
  details.className = `tool-block tool-${type}`;
  details.open = (type === "navigate" || type === "get_page_text");
  const summary = document.createElement("summary");
  summary.textContent = summaryMap[type] || type;
  const body = document.createElement("div");
  body.className = "tool-body";

  if (type === "navigate") {
    body.textContent = `URL: ${data.url}\nTitle: ${data.title || "N/A"}\nContent: ${data.textLength || 0} chars`;
    if (data.pageText) {
      body.textContent += `\n\n--- Page Content Preview ---\n${data.pageText.slice(0, 2000)}`;
    }
  } else if (type === "get_page_text") {
    body.textContent = `Fetched ${data.length || 0} chars from ${data.url}`;
    if (data.pageText) {
      body.textContent += `\n\n--- Page Content ---\n${data.pageText.slice(0, 4000)}`;
    }
  } else if (type === "extract_links") {
    body.textContent = `${data.count || 0} links found`;
  } else if (type === "extract_forms") {
    body.textContent = `${data.count || 0} forms found`;
  } else if (type === "get_page_structure") {
    body.textContent = `${data.count || 0} sections found on ${data.url}`;
  } else if (type === "click_link") {
    body.textContent = `Navigated to ${data.url}`;
  } else if (type === "fill_form") {
    body.textContent = `Field: ${data.field} = "${data.value}"`;
  } else if (type === "submit_form") {
    body.textContent = `Submitted to ${data.url}, status: ${data.result || "ok"}`;
  }

  details.append(summary, body);
  messagesEl.appendChild(details);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatListText(entries) {
  return (entries || []).map((e) => `${e.kind === "directory" ? "📁" : "📄"} ${e.name}`).join("\n");
}

function formatSearchText(hits) {
  return (hits || [])
    .map((h) => `File: ${h.path}\n` + h.matches.map((m) => `  ${m.line}: ${m.text}`).join("\n"))
    .join("\n\n");
}

/* ---------- Settings dialog ---------- */
function openSettings() {
  try {
    const dlg = $("settings-dialog");
    if (!dlg) throw new Error("Settings dialog element not found");
    try { renderConnectionsList(); } catch (re) { console.error("renderConnectionsList failed", re); }
    try { renderAgentsList(); } catch (re) { console.error("renderAgentsList failed", re); }
    const budgetInput = $("credit-budget");
    if (budgetInput) budgetInput.value = state.settings.creditBudget ?? "";

    // RAG settings
    const ragSection = $("rag-settings");
    if (ragSection) ragSection.hidden = false;
    try { renderKBList(); } catch (re) { console.error("renderKBList failed", re); }
    const ragEmbeddingProvider = $("rag-embedding-provider");
    if (ragEmbeddingProvider) ragEmbeddingProvider.value = state.settings.ragEmbeddingProvider;
    const ragTopK = $("rag-top-k");
    if (ragTopK) ragTopK.value = state.settings.ragTopK;
    const ragChunkSize = $("rag-chunk-size");
    if (ragChunkSize) ragChunkSize.value = state.settings.ragChunkSize;
    const ragChunkOverlap = $("rag-chunk-overlap");
    if (ragChunkOverlap) ragChunkOverlap.value = state.settings.ragChunkOverlap;

    // Voice settings
    if (ttsProviderEl) ttsProviderEl.value = state.settings.ttsProvider || "web-speech";
    if (ttsLangEl) ttsLangEl.value = state.settings.ttsLang || "";
    if (ttsRateEl) ttsRateEl.value = state.settings.ttsRate ?? 1;
    if (ttsPitchEl) ttsPitchEl.value = state.settings.ttsPitch ?? 1;
    if (voiceInputProviderEl) voiceInputProviderEl.value = state.settings.voiceInputProvider || "web-speech";

    if (dlg.open) dlg.close();
    dlg.classList.remove("dialog-open");
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
      // Defensive: ensure it really opened.
      if (!dlg.open) {
        dlg.setAttribute("open", "");
        dlg.classList.add("dialog-open");
      }
    } else {
      dlg.setAttribute("open", "");
      dlg.classList.add("dialog-open");
    }
  } catch (e) {
    console.error("openSettings failed", e);
    alert("Could not open settings: " + (e?.message || e));
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
  const list = $("connections-list");
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
}

function renderAgentsList() {
  const list = $("agents-list");
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
function openAddConnection(existing = null) {
  const dlg = $("add-dialog");
  const editingId = existing?.id || null;
  $("add-form").dataset.editing = editingId || "";
  $("add-title").textContent = editingId ? "Edit connection" : "Add connection";

  const typeSelect = $("add-type");
  typeSelect.innerHTML = "";
  for (const id of CONNECTION_TYPE_ORDER) {
    const t = CONNECTION_TYPES[id];
    const o = document.createElement("option");
    o.value = id;
    o.textContent = t.label;
    typeSelect.appendChild(o);
  }

  function updateForm(typeId) {
    const t = typeById(typeId);
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
  }

  if (existing) {
    typeSelect.value = existing.type;
    $("add-label").value = existing.label || "";
    $("add-endpoint").value = existing.endpoint || "";
    $("add-model").value = existing.model || "";
    $("add-key").value = existing.key || "";
  } else {
    typeSelect.value = CONNECTION_TYPE_ORDER[0];
    $("add-label").value = "";
    $("add-endpoint").value = "";
    $("add-model").value = "";
    $("add-key").value = "";
  }
  updateForm(typeSelect.value);

  typeSelect.onchange = () => updateForm(typeSelect.value);
  $("add-test-result").textContent = "";

  if (dlg.open) dlg.close();
  if (typeof dlg.showModal === "function") dlg.showModal();
  else {
    dlg.setAttribute("open", "");
    dlg.classList.add("dialog-open");
  }
}

function closeAddConnection() {
  try {
    const dlg = $("add-dialog");
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
  renderConnectionsList();
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

async function clearAll() {
  if (!confirm("Delete ALL conversations, settings, and knowledge base from this browser? This cannot be undone.")) return;
  await dbClear();
  try { await kbClear(); } catch (e) { console.error("kbClear failed", e); }
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(OLD_SETTINGS_KEY);
  localStorage.removeItem(OLDER_SETTINGS_KEY);
  localStorage.removeItem(SESSION_USAGE_KEY);
  state.settings = {
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
  };
  state.conversations = [];
  state.activeId = null;
  state.sessionTokens = 0;
  renderChatList();
  renderMessages();
  renderConnectionSelect();
  renderAgentSelect();
  closeSettings();
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
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
  if (window.matchMedia("(max-width: 720px)").matches) sidebarEl.dataset.open = "false";
}

/* ---------- Online / sidebar / credit UI ---------- */
function toggleSidebar() {
  sidebarEl.dataset.open = sidebarEl.dataset.open === "true" ? "false" : "true";
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

function updateComposerPlaceholder() {
  if (!inputEl) return;
  if (!state.settings.onlineMode) {
    inputEl.placeholder = "Offline mode — enable Online to send";
  } else {
    inputEl.placeholder = "Message… (Enter to send, Shift+Enter for newline)";
  }
}

function updateComposerForOnline() {
  if (!inputEl) return;
  inputEl.disabled = !state.settings.onlineMode;
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


/* ---------- Knowledge base ---------- */
async function renderKBList() {
  if (!kbListEl) return;
  kbListEl.innerHTML = "";
  try {
    const files = await getKnowledgeBaseFiles();
    if (files.length === 0) {
      kbListEl.innerHTML = '<p class="muted">No documents in the knowledge base yet.</p>';
      return;
    }
    const rows = document.createElement("div");
    rows.className = "rows";
    for (const f of files) {
      const row = document.createElement("div");
      row.className = "row-item";
      const info = document.createElement("div");
      info.className = "row-info";
      const title = document.createElement("div");
      title.className = "row-title";
      title.textContent = f.name;
      const sub = document.createElement("div");
      sub.className = "row-sub";
      sub.textContent = `${f.chunks} chunk${f.chunks === 1 ? "" : "s"} · ${formatBytes(f.size)}`;
      info.append(title, sub);
      const controls = document.createElement("div");
      controls.className = "row-actions";
      const del = document.createElement("button");
      del.className = "icon-btn danger";
      del.title = "Remove from knowledge base";
      del.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      del.onclick = async () => {
        if (confirm(`Remove ${f.name} and its chunks from the knowledge base?`)) {
          await removeFileFromKnowledgeBase(f.fileId);
          await renderKBList();
        }
      };
      controls.appendChild(del);
      row.append(info, controls);
      rows.appendChild(row);
    }
    kbListEl.appendChild(rows);
  } catch (e) {
    console.error("renderKBList failed", e);
    kbListEl.innerHTML = `<p class="muted">Could not load knowledge base: ${e.message || e}</p>`;
  }
}

async function onKBFileSelect(e) {
  const files = e.target.files;
  if (!files?.length) return;
  if (!state.settings.ragEmbeddingProvider) {
    alert("Choose an embedding provider in Settings before adding files.");
    e.target.value = "";
    return;
  }
  const embConnection = findEnabledConnection([state.settings.ragEmbeddingProvider]);
  if (!embConnection) {
    alert(`No enabled ${state.settings.ragEmbeddingProvider} connection found.`);
    e.target.value = "";
    return;
  }
  for (const file of Array.from(files)) {
    const progress = document.createElement("div");
    progress.className = "kb-progress";
    progress.textContent = `Indexing ${file.name}…`;
    kbListEl?.appendChild(progress);
    try {
      await addFileToKnowledgeBase(file, embConnection, state.settings, new AbortController().signal, (p) => {
        progress.textContent = `Indexing ${file.name}… ${p.done}/${p.total}`;
      });
      progress.remove();
    } catch (err) {
      console.error("KB upload failed", file.name, err);
      progress.textContent = `Failed ${file.name}: ${err.message || err}`;
      progress.classList.add("kb-error");
    }
  }
  e.target.value = "";
  await renderKBList();
}

/* ---------- Browser mode ---------- */

function toggleBrowserMode() {
  state.browserMode = !state.browserMode;
  const isBrowser = state.browserMode;

  browserView.hidden = !isBrowser;
  splitHandle.hidden = !isBrowser;
  messagesEl.classList.toggle("browser-active", isBrowser);
  browserBtn.classList.toggle("active", isBrowser);

  if (isBrowser) {
    // Reset to 60/40 split (chat gets more space)
    messagesEl.style.flex = "1 1 60%";
    browserView.style.flex = "1 1 40%";
    inputEl.placeholder = "Type a command for the browser agent… (Enter to send)";
    inputEl.disabled = false;
    inputEl.focus();
    // Show start page if no URL loaded
    if (!browserIframe.src || browserIframe.src === "about:blank") {
      browserPlaceholder.hidden = false;
    }
  } else {
    // Clear inline styles
    messagesEl.style.flex = "";
    browserView.style.flex = "";
    updateComposerPlaceholder();
    updateComposerForOnline();
  }
}

function navigateToUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return;
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    browserUrlInput.value = parsed.href;
    if (state.browserHistoryIndex < state.browserHistory.length - 1) {
      state.browserHistory = state.browserHistory.slice(0, state.browserHistoryIndex + 1);
    }
    state.browserHistory.push(parsed.href);
    state.browserHistoryIndex = state.browserHistory.length - 1;
    browserPlaceholder.hidden = true;
    browserIframe.src = parsed.href;
    updateBrowserNavButtons();
  } catch (e) {
    browserUrlInput.style.borderColor = "var(--danger)";
    setTimeout(() => { browserUrlInput.style.borderColor = ""; }, 1000);
  }
}

function handleBrowserStartInput(value) {
  if (!value || !value.trim()) return;
  const trimmed = value.trim();
  // If it looks like a URL, navigate directly
  if (/^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(trimmed)) {
    navigateToUrl(trimmed);
  } else {
    // Otherwise, search using Google
    const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(trimmed);
    navigateToUrl(searchUrl);
  }
}

function browserGoBack() {
  if (state.browserHistoryIndex <= 0) return;
  state.browserHistoryIndex--;
  const url = state.browserHistory[state.browserHistoryIndex];
  browserUrlInput.value = url;
  browserIframe.src = url;
  updateBrowserNavButtons();
}

function browserGoForward() {
  if (state.browserHistoryIndex >= state.browserHistory.length - 1) return;
  state.browserHistoryIndex++;
  const url = state.browserHistory[state.browserHistoryIndex];
  browserUrlInput.value = url;
  browserIframe.src = url;
  updateBrowserNavButtons();
}

function browserRefresh() {
  if (!browserIframe.src) return;
  const currentSrc = browserIframe.src;
  browserIframe.src = "";
  setTimeout(() => { browserIframe.src = currentSrc; }, 50);
}

function updateBrowserNavButtons() {
  browserBackBtn.disabled = state.browserHistoryIndex <= 0;
  browserForwardBtn.disabled = state.browserHistoryIndex >= state.browserHistory.length - 1;
}

/* ---------- Split handle resize ---------- */
let isResizing = false;

function initSplitResize() {
  if (!splitHandle) return;
  splitHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isResizing = true;
    splitHandle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const chatSplit = splitHandle.parentElement;
    const rect = chatSplit.getBoundingClientRect();
    const isMobile = window.matchMedia("(max-width: 720px)").matches;
    let ratio;
    if (isMobile) {
      // Vertical resize
      ratio = (e.clientY - rect.top) / rect.height;
    } else {
      // Horizontal resize
      ratio = (e.clientX - rect.left) / rect.width;
    }
    // Clamp between 25% and 75%
    ratio = Math.max(0.25, Math.min(0.75, ratio));
    const leftPct = (ratio * 100).toFixed(1);
    const rightPct = (100 - ratio * 100).toFixed(1);
    messagesEl.style.flex = `1 1 ${leftPct}%`;
    browserView.style.flex = `1 1 ${rightPct}%`;
  });
  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      splitHandle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}

/* ---------- Init ---------- */
async function init() {
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
  inputEl.addEventListener("input", autoGrow);
  inputEl.addEventListener("paste", onPaste);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  composerEl.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(); });
  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  stopBtn.addEventListener("click", () => { if (state.streaming) stopStreaming(); });

  // Browser mode
  if (browserBtn) {
    browserBtn.addEventListener("click", toggleBrowserMode);
  }
  if (browserGoBtn) {
    browserGoBtn.addEventListener("click", () => navigateToUrl(browserUrlInput.value));
  }
  if (browserUrlInput) {
    browserUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        navigateToUrl(browserUrlInput.value);
      }
    });
  }
  if (browserBackBtn) {
    browserBackBtn.addEventListener("click", browserGoBack);
  }
  if (browserForwardBtn) {
    browserForwardBtn.addEventListener("click", browserGoForward);
  }
  if (browserRefreshBtn) {
    browserRefreshBtn.addEventListener("click", browserRefresh);
  }
  if (browserStartInput) {
    browserStartInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleBrowserStartInput(browserStartInput.value);
      }
    });
  }
  if (browserStartGoBtn) {
    browserStartGoBtn.addEventListener("click", () => {
      handleBrowserStartInput(browserStartInput?.value || "");
    });
  }

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
  if (addKbBtn && kbFileInput) {
    addKbBtn.addEventListener("click", () => kbFileInput.click());
    kbFileInput.addEventListener("change", onKBFileSelect);
  }
  connectionSelectEl.addEventListener("change", onConnectionSelectChange);
  agentSelectEl.addEventListener("change", onAgentSelectChange);

  // Sidebar
  $("btn-new").onclick = () => { clearAttachments(); newConv(); closeSidebarMobile(); };
  if (sidebarHandleEl) sidebarHandleEl.addEventListener("click", toggleSidebar);

  // Topbar actions
  $("btn-settings").onclick = openSettings;
  $("btn-import").onclick = () => $("file-import").click();
  $("btn-export").onclick = exportData;
  if (exportChatBtn) {
    exportChatBtn.addEventListener("click", exportChatAsHtml);
  }
  if (onlineBtnEl) onlineBtnEl.addEventListener("click", toggleOnline);
  if (readmeBtn) {
    readmeBtn.addEventListener("click", () => window.open("README.md", "_blank"));
  }
  if (techDocBtn) {
    techDocBtn.addEventListener("click", () => window.open("tech-doc.md", "_blank"));
  }
  if (contactBtn) {
    contactBtn.addEventListener("click", () => { window.location.href = "mailto:hello@pyaek.com"; });
  }
  $("file-import").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importData(f);
    e.target.value = "";
  });
  $("search").addEventListener("input", renderChatList);

  // Settings dialog
  const settingsDlg = $("settings-dialog");
  if (!settingsDlg) throw new Error("Required #settings-dialog element is missing from the page");
  $("btn-close").onclick = () => closeSettings();
  $("btn-clear-all").onclick = clearAll;
  $("btn-add-connection").onclick = () => openAddConnection();
  $("btn-add-agent").onclick = () => openAddAgent();
  const resetAgentsBtn = $("btn-reset-agents");
  if (resetAgentsBtn) {
    resetAgentsBtn.onclick = () => {
      if (confirm("Restore the 8 default agents to their original prompts? Your custom agents will stay.")) {
        state.settings.agents = mergeAgents(state.settings.agents);
        saveSettings(state.settings);
        renderAgentsList();
        renderAgentSelect();
        resetAgentsBtn.textContent = "defaults restored";
        setTimeout(() => resetAgentsBtn.textContent = "restore defaults", 1200);
      }
    };
  }
  const resetUsageBtn = $("btn-reset-usage");
  if (resetUsageBtn) {
    resetUsageBtn.onclick = () => {
      resetSessionUsage();
      state.sessionTokens = 0;
      renderChatList();
      resetUsageBtn.textContent = "usage reset";
      setTimeout(() => resetUsageBtn.textContent = "reset today’s usage", 1200);
    };
  }
  $("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const budgetInput = $("credit-budget");
    if (budgetInput) {
      const val = Number(budgetInput.value);
      state.settings.creditBudget = Math.max(0, Number.isFinite(val) ? val : 0);
    }

    // RAG
    state.settings.ragEmbeddingProvider = $("rag-embedding-provider")?.value || "";
    state.settings.ragTopK = Math.max(1, Math.min(20, Number($("rag-top-k")?.value) || 5));
    state.settings.ragChunkSize = Math.max(100, Math.min(2000, Number($("rag-chunk-size")?.value) || 500));
    state.settings.ragChunkOverlap = Math.max(0, Math.min(500, Number($("rag-chunk-overlap")?.value) || 100));
    state.settings.ragEnabled = !!state.settings.ragEmbeddingProvider;

    // Voice
    state.settings.ttsProvider = ttsProviderEl?.value || "web-speech";
    state.settings.ttsLang = ttsLangEl?.value || "";
    state.settings.ttsRate = Math.max(0.5, Math.min(2, Number(ttsRateEl?.value) || 1));
    state.settings.ttsPitch = Math.max(0.5, Math.min(2, Number(ttsPitchEl?.value) || 1));
    state.settings.voiceInputProvider = voiceInputProviderEl?.value || "web-speech";

    saveSettings(state.settings);
    closeSettings();
  });
  settingsDlg.addEventListener("click", (e) => {
    if (e.target === settingsDlg) closeSettings();
  });
  if (settingsDlg.open) closeSettings();
  settingsDlg.classList.remove("dialog-open");

  // Add-connection dialog
  const addDlg = $("add-dialog");
  if (!addDlg) throw new Error("Required #add-dialog element is missing from the page");
  $("btn-add-close").onclick = () => closeAddConnection();
  $("btn-add-test").onclick = (e) => { e.preventDefault(); testAddConnection(); };
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveConnectionFromDialog();
  });
  addDlg.addEventListener("click", (e) => {
    if (e.target === addDlg) closeAddConnection();
  });
  if (addDlg.open) closeAddConnection();
  addDlg.classList.remove("dialog-open");

  // Add-agent dialog
  const agentDlg = $("agent-dialog");
  if (!agentDlg) throw new Error("Required #agent-dialog element is missing from the page");
  $("btn-agent-close").onclick = () => closeAddAgent();
  $("agent-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveAgentFromDialog();
  });
  agentDlg.addEventListener("click", (e) => {
    if (e.target === agentDlg) closeAddAgent();
  });
  if (agentDlg.open) closeAddAgent();
  agentDlg.classList.remove("dialog-open");

  // Network status
  window.addEventListener("online", updateNetStatus);
  window.addEventListener("offline", updateNetStatus);

  // Folder / project panel
  if (linkFolderBtn) linkFolderBtn.onclick = openLinkDialog;
  if (refreshFolderBtn) refreshFolderBtn.onclick = refreshFolder;
  if (disconnectFolderBtn) disconnectFolderBtn.onclick = disconnectFolder;
  if (previewCloseBtn) previewCloseBtn.onclick = closePreviewDialog;
  if (previewDialog) previewDialog.addEventListener("click", (e) => { if (e.target === previewDialog) closePreviewDialog(); });
  if (linkCloseBtn) linkCloseBtn.onclick = () => closeLinkDialog();
  if (linkFolderChoiceBtn) linkFolderChoiceBtn.onclick = () => connectFolder();
  if (linkFileChoiceBtn) linkFileChoiceBtn.onclick = () => connectFile();
  if (linkDialog) linkDialog.addEventListener("click", (e) => { if (e.target === linkDialog) closeLinkDialog(); });
  renderFsBanner();
  updateLinkButton();
  await restoreFolder();

  // Browser mode initial state
  updateBrowserNavButtons();
  initSplitResize();
  browserView.hidden = true;
}

/* ---------- File system / project panel ---------- */
function renderFsBanner() {
  if (!fsaBanner) return;
  fsaBanner.hidden = isFileSystemAccessSupported();
}

function openLinkDialog() {
  if (!isFileSystemAccessSupported()) {
    alert("Folder/file linking requires Chrome or Edge on desktop. Use the attach button to include individual files.");
    return;
  }
  if (fs.connected) {
    // If already linked, offer to disconnect instead of opening the picker menu.
    if (confirm(`Disconnect linked ${fs.mode === "file" ? "file" : "folder"}: ${fs.name || fs.filePath}?`)) {
      disconnectFolder();
    }
    return;
  }
  if (!linkDialog) return;
  if (linkDialog.open) linkDialog.close();
  if (typeof linkDialog.showModal === "function") linkDialog.showModal();
  else {
    linkDialog.setAttribute("open", "");
    linkDialog.classList.add("dialog-open");
  }
}

function closeLinkDialog() {
  if (!linkDialog) return;
  linkDialog.close();
  linkDialog.classList.remove("dialog-open");
  linkDialog.removeAttribute("open");
}

async function connectFolder() {
  if (!isFileSystemAccessSupported()) {
    alert("Folder access requires Chrome or Edge on desktop. Use the attach button to include individual files.");
    return;
  }
  try {
    const info = await fs.connectFolder();
    fileTreeCache = [];
    await refreshFolder();
    renderProjectPanel();
    updateLinkButton();
    renderAttachmentPreview();
    renderAgentSelect();
    closeLinkDialog();
  } catch (e) {
    console.error("connectFolder failed", e);
    alert("Could not connect folder: " + (e.message || e));
  }
}

async function connectFile() {
  if (!isFileSystemAccessSupported()) {
    alert("File linking requires Chrome or Edge on desktop. Use the attach button to include individual files.");
    return;
  }
  try {
    const info = await fs.connectFile();
    fileTreeCache = [];
    await refreshFolder();
    renderProjectPanel();
    updateLinkButton();
    renderAttachmentPreview();
    renderAgentSelect();
    closeLinkDialog();
  } catch (e) {
    console.error("connectFile failed", e);
    alert("Could not link file: " + (e.message || e));
  }
}

function updateLinkButton() {
  if (!linkFolderBtn) return;
  linkFolderBtn.classList.toggle("linked", fs.connected);
  linkFolderBtn.title = fs.connected
    ? `Linked ${fs.mode === "file" ? "file" : "folder"}: ${fs.name || fs.filePath} (click to disconnect)`
    : "Link folder or file for agentic AI";
}

async function disconnectFolder() {
  await fs.disconnect();
  fileTreeCache = [];
  activeFilePath = null;
  renderProjectPanel();
  updateLinkButton();
  renderAttachmentPreview();
  renderAgentSelect();
}

async function restoreFolder() {
  if (!isFileSystemAccessSupported()) return;
  try {
    const info = await fs.restoreFolder();
    if (!info) return;
    const perm = await fs.requestPermission();
    if (perm === "denied") {
      await fs.disconnect();
      renderAgentSelect();
      return;
    }
    await refreshFolder();
    renderProjectPanel();
    updateLinkButton();
    renderAttachmentPreview();
    renderAgentSelect();
  } catch (e) {
    console.error("restoreFolder failed", e);
  }
}

async function refreshFolder() {
  if (!fs.connected) {
    renderProjectPanel();
    return;
  }
  try {
    fileTreeCache = await fs.list(".", true);
    renderFileTree();
  } catch (e) {
    console.error("refreshFolder failed", e);
  }
}

function renderProjectPanel() {
  if (!projectPanel || !projectNameEl) return;
  if (fs.connected) {
    projectPanel.hidden = false;
    projectNameEl.textContent = fs.name || fs.filePath || "Project";
    renderFileTree();
  } else {
    projectPanel.hidden = true;
  }
}

function renderFileTree() {
  if (!fileTreeEl) return;
  fileTreeEl.innerHTML = "";
  const ul = document.createElement("ul");
  for (const entry of fileTreeCache) ul.appendChild(buildTreeNode(entry));
  fileTreeEl.appendChild(ul);
}

function buildTreeNode(entry) {
  const li = document.createElement("li");
  li.dataset.path = entry.path;
  if (entry.kind === "directory") {
    li.className = "collapsed";
    const toggle = document.createElement("span");
    toggle.className = "folder-toggle";
    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    toggle.onclick = (e) => { e.stopPropagation(); li.classList.toggle("collapsed"); };
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = entry.name;
    li.append(toggle, icon, name);
    if (entry.children?.length) {
      const childUl = document.createElement("ul");
      for (const child of entry.children) childUl.appendChild(buildTreeNode(child));
      li.appendChild(childUl);
    }
  } else {
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = entry.name;
    li.append(icon, name);
    li.onclick = () => previewFile(entry.path);
    li.classList.toggle("active", entry.path === activeFilePath);
  }
  return li;
}

async function previewFile(path) {
  if (!fs.connected || !path) return;
  activeFilePath = path;
  renderFileTree();
  try {
    const text = await fs.readText(path);
    previewTitle.textContent = path;
    previewContent.textContent = text;
    if (previewDialog) {
      if (previewDialog.open) previewDialog.close();
      if (typeof previewDialog.showModal === "function") previewDialog.showModal();
      else {
        previewDialog.setAttribute("open", "");
        previewDialog.classList.add("dialog-open");
      }
    }
  } catch (e) {
    alert("Could not read file: " + (e.message || e));
  }
}

function closePreviewDialog() {
  if (!previewDialog) return;
  previewDialog.close();
  previewDialog.classList.remove("dialog-open");
  previewDialog.removeAttribute("open");
}

init().catch((e) => {
  console.error("init failed", e);
  const el = document.createElement("div");
  el.className = "empty-hint";
  el.textContent = "Failed to initialize: " + (e.message || e);
  messagesEl.appendChild(el);
});
