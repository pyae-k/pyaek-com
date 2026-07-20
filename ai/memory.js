// memory.js — lightweight agent memory layer for ChatAI.
// Stores short factual notes scoped to global, conversation, or agent.
// Retrieval is keyword/phrase matching today; can be upgraded to embeddings later.

import { openDB, MEMORY_STORE } from "./db.js";

function uid() {
  return "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function nowTs() {
  return Date.now();
}

async function dbPut(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, "readwrite");
    tx.objectStore(MEMORY_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, "readonly");
    const req = tx.objectStore(MEMORY_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, "readwrite");
    tx.objectStore(MEMORY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, "readwrite");
    tx.objectStore(MEMORY_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏЀ-ӿ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreMemory(entry, queryTokens, convId, agentId) {
  const contentTokens = tokenize(entry.content);
  let score = 0;
  for (const qt of queryTokens) {
    if (contentTokens.includes(qt)) score += 1;
    // Also match multi-word phrases by substring.
    if (entry.content.toLowerCase().includes(qt)) score += 0.5;
  }
  // Boost by scope relevance.
  if (entry.scope === "global") score += 0.2;
  if (entry.convId && entry.convId === convId) score += 1.5;
  if (entry.agentId && entry.agentId === agentId) score += 1.0;
  // Slight recency boost.
  const ageDays = (nowTs() - (entry.createdAt || 0)) / (1000 * 60 * 60 * 24);
  score += Math.max(0, 1 - ageDays / 90) * 0.3;
  return score;
}

export async function addMemory(content, options = {}) {
  const entry = {
    id: uid(),
    content: String(content || "").trim(),
    scope: options.scope || "global",
    convId: options.convId || null,
    agentId: options.agentId || null,
    source: options.source || "user",
    createdAt: nowTs(),
  };
  if (!entry.content) throw new Error("Memory content is empty");
  await dbPut(entry);
  return entry;
}

export async function removeMemory(id) {
  await dbDelete(id);
}

export async function clearMemory() {
  await dbClear();
}

export async function listMemory(options = {}) {
  const all = await dbAll();
  let filtered = all;
  if (options.scope) filtered = filtered.filter((m) => m.scope === options.scope);
  if (options.convId) filtered = filtered.filter((m) => m.convId === options.convId || m.scope === "global");
  if (options.agentId) filtered = filtered.filter((m) => m.agentId === options.agentId || m.scope === "global");
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function searchMemory(query, options = {}) {
  const queryTokens = tokenize(query);
  const all = await dbAll();
  const scored = all
    .filter((m) => {
      if (options.scope && m.scope !== options.scope) return false;
      if (options.convId && m.scope === "conversation" && m.convId !== options.convId) return false;
      if (options.agentId && m.scope === "agent" && m.agentId !== options.agentId) return false;
      return true;
    })
    .map((m) => ({ entry: m, score: scoreMemory(m, queryTokens, options.convId, options.agentId) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, options.limit ?? 5).map((s) => s.entry);
}

export async function getMemoryContext({ query, convId, agentId, limit = 5 } = {}) {
  const relevant = await searchMemory(query || "", { convId, agentId, limit });
  if (!relevant.length) return "";
  const lines = relevant.map((m, i) => `${i + 1}. ${m.content}`);
  return `Relevant things I remember:\n${lines.join("\n")}`;
}

// Extract short factual notes from a user message or assistant response.
// This is intentionally simple; later phases can use a small model call.
export function extractFacts(text) {
  const facts = [];
  const lower = String(text || "").toLowerCase();

  // Preference patterns — capture short phrases, stopping at sentence punctuation.
  const prefPatterns = [
    /(?:i (?:like|love|prefer|enjoy|hate|dislike)|my favorite|my preferred)\s+([^.,;:!?]{3,120})/gi,
    /(?:i am|i'm)\s+(?:a|an)\s+([^.,;:!?]{3,80})/gi,
    /(?:i work as|my job is|i'm a)\s+([^.,;:!?]{3,80})/gi,
    /(?:my name is|call me)\s+([a-z0-9À-ɏЀ-ӿ]+(?:\s+[a-z0-9À-ɏЀ-ӿ]+){0,2})/gi,
    /(?:my project|my app|my company|my team)\s+(?:is|are|uses?)\s+([^.,;:!?]{3,120})/gi,
  ];
  for (const re of prefPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1].trim();
      if (raw.length < 5) continue;
      facts.push(raw.charAt(0).toUpperCase() + raw.slice(1));
    }
  }

  // Explicit memory commands
  const rememberRe = /(?:remember that|note that|make a note|don't forget)\s+([^.!?]{5,200}[.!?]?)/gi;
  let m;
  while ((m = rememberRe.exec(text)) !== null) {
    facts.push(m[1].trim());
  }

  return [...new Set(facts)].slice(0, 5);
}

export async function rememberFromMessage(text, options = {}) {
  const facts = extractFacts(text);
  const added = [];
  for (const fact of facts) {
    const entry = await addMemory(fact, options);
    added.push(entry);
  }
  return added;
}
