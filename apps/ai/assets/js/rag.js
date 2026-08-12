// rag.js — lightweight client-side RAG for ChatAI PWA.
// Chunks uploaded documents, calls an embedding API, stores vectors in IndexedDB,
// and retrieves relevant chunks with cosine similarity.

import { openDB, KB_STORE } from "./db.js";
import { typeById } from "./providers.js";
import { extractTextFromFile, chunkText, getDocumentExtension } from "./doc-parser.js";

/* ---------- IndexedDB helpers ---------- */

async function kbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readonly");
    const req = tx.objectStore(KB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function kbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readwrite");
    tx.objectStore(KB_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readwrite");
    tx.objectStore(KB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readwrite");
    tx.objectStore(KB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function uid() {
  return "kb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Embedding APIs ---------- */

async function embedOpenAI(connection, texts, signal) {
  const endpoint = connection.endpoint || "https://api.openai.com/v1/embeddings";
  const key = connection.key || "";
  const model = connection.model || "text-embedding-3-small";
  if (!key) throw new Error("OpenAI embeddings require an API key");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ input: texts, model }),
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenAI embeddings HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.data.map((d) => d.embedding);
}

async function embedOllama(connection, texts, signal) {
  const endpoint = connection.endpoint || "http://localhost:11434/api/embeddings";
  const model = connection.model || "nomic-embed-text";
  const embeddings = [];
  for (const text of texts) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Ollama embeddings HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    embeddings.push(data.embedding);
  }
  return embeddings;
}

async function embedGemini(connection, texts, signal) {
  let endpoint = connection.endpoint || "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
  const key = connection.key || "";
  if (!key) throw new Error("Gemini embeddings require an API key");
  if (endpoint.includes("?")) endpoint += "&key=" + key;
  else endpoint += "?key=" + key;

  const embeddings = [];
  for (const text of texts) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
      signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Gemini embeddings HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    embeddings.push(data.embedding?.values || data.embedding);
  }
  return embeddings;
}

export async function embedTexts(connection, texts, signal) {
  const type = typeById(connection.type);
  if (!type) throw new Error("Unknown embedding provider");
  if (connection.type === "openai_embeddings") return embedOpenAI(connection, texts, signal);
  if (connection.type === "ollama_embeddings") return embedOllama(connection, texts, signal);
  if (connection.type === "gemini_embeddings") return embedGemini(connection, texts, signal);
  throw new Error(`Unsupported embedding provider: ${connection.type}`);
}

/* ---------- Vector similarity ---------- */

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/* ---------- Public API ---------- */

export async function getKnowledgeBaseFiles() {
  const all = await kbGetAll();
  const byFile = new Map();
  for (const item of all) {
    if (!byFile.has(item.fileId)) {
      byFile.set(item.fileId, {
        fileId: item.fileId,
        name: item.fileName,
        size: item.fileSize,
        ext: item.fileExt,
        chunks: 0,
        createdAt: item.createdAt,
      });
    }
    byFile.get(item.fileId).chunks += 1;
  }
  return Array.from(byFile.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addFileToKnowledgeBase(file, connection, settings, signal, onProgress) {
  const text = await extractTextFromFile(file);
  if (!text?.trim()) throw new Error("No text could be extracted from this file");

  const chunks = chunkText(text, {
    chunkSize: settings.ragChunkSize || 500,
    overlap: settings.ragChunkOverlap || 100,
  });
  if (chunks.length === 0) throw new Error("Document is too short to chunk");

  const fileId = uid();
  const fileName = file.name;
  const fileSize = file.size;
  const fileExt = getDocumentExtension(file.name);

  // Embed in batches of 16 to avoid huge payloads.
  const embeddings = [];
  const batchSize = 16;
  for (let i = 0; i < chunks.length; i += batchSize) {
    if (signal?.aborted) throw new Error("aborted");
    const batch = chunks.slice(i, i + batchSize);
    const embs = await embedTexts(connection, batch, signal);
    embeddings.push(...embs);
    if (onProgress) onProgress({ done: Math.min(i + batchSize, chunks.length), total: chunks.length });
  }

  const now = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    await kbPut({
      id: uid(),
      fileId,
      fileName,
      fileSize,
      fileExt,
      chunkText: chunks[i],
      embedding: embeddings[i],
      createdAt: now,
    });
  }
  return { fileId, name: fileName, chunks: chunks.length };
}

export async function removeFileFromKnowledgeBase(fileId) {
  const all = await kbGetAll();
  for (const item of all) {
    if (item.fileId === fileId) await kbDelete(item.id);
  }
}

export async function searchKnowledgeBase(queryEmbedding, topK = 5) {
  const all = await kbGetAll();
  const scored = all
    .filter((item) => item.embedding?.length && item.chunkText?.trim())
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function embedQuery(connection, query, signal) {
  const embs = await embedTexts(connection, [query], signal);
  return embs[0];
}

export function formatKBContext(results) {
  if (!results?.length) return "";
  const lines = ["Knowledge base excerpts:"];
  results.forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.fileName}\n${r.chunkText}`);
  });
  return lines.join("\n\n");
}

export { kbClear };
