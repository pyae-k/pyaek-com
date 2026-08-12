// tools.js — external tool API wrappers for ChatAI PWA.
// Image generation, web search, and URL fetch. All run from the browser via fetch.

import { typeById } from "./providers.js";

// ---------- Image generation ----------

export async function generateImage(connection, prompt, signal) {
  const type = typeById(connection.type);
  if (!type) throw new Error("Unknown image provider");
  if (connection.type === "dalle") return generateDalle(connection, prompt, signal);
  if (connection.type === "stability") return generateStability(connection, prompt, signal);
  throw new Error(`Unsupported image provider: ${connection.type}`);
}

async function generateDalle(connection, prompt, signal) {
  const endpoint = connection.endpoint || "https://api.openai.com/v1/images/generations";
  const key = connection.key || "";
  const model = connection.model || "dall-e-3";
  if (!key) throw new Error("OpenAI DALL·E requires an API key");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: model === "dall-e-2" ? "512x512" : "1024x1024",
      response_format: "b64_json",
    }),
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`DALL·E HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (!b64 && !url) throw new Error("DALL·E returned no image");
  return b64 ? `data:image/png;base64,${b64}` : url;
}

async function generateStability(connection, prompt, signal) {
  let endpoint = connection.endpoint || "https://api.stability.ai/v2beta/stable-image/generate/sd3";
  const key = connection.key || "";
  if (!key) throw new Error("Stability AI requires an API key");

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  form.append("aspect_ratio", "1:1");
  form.append("model", connection.model || "sd3");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, Accept: "image/*" },
    body: form,
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Stability AI HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const blob = await resp.blob();
  return blobToDataURL(blob);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------- Web search ----------

export async function searchWeb(connection, query, signal) {
  const type = typeById(connection.type);
  if (!type) throw new Error("Unknown search provider");
  if (connection.type === "tavily") return searchTavily(connection, query, signal);
  if (connection.type === "brave_search") return searchBrave(connection, query, signal);
  if (connection.type === "serpapi") return searchSerpApi(connection, query, signal);
  throw new Error(`Unsupported search provider: ${connection.type}`);
}

async function searchTavily(connection, query, signal) {
  const endpoint = connection.endpoint || "https://api.tavily.com/search";
  const key = connection.key || "";
  if (!key) throw new Error("Tavily requires an API key");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Tavily HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || r.snippet || "",
  }));
}

async function searchBrave(connection, query, signal) {
  const endpoint = connection.endpoint || "https://api.search.brave.com/res/v1/web/search";
  const key = connection.key || "";
  if (!key) throw new Error("Brave Search requires an API key");

  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Brave Search HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description || "",
  }));
}

async function searchSerpApi(connection, query, signal) {
  const endpoint = connection.endpoint || "https://serpapi.com/search";
  const key = connection.key || "";
  if (!key) throw new Error("SerpApi requires an API key");

  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("engine", connection.model || "google");
  url.searchParams.set("api_key", key);
  url.searchParams.set("num", "8");

  const resp = await fetch(url, { method: "GET", signal });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`SerpApi HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const results = data?.organic_results || data?.results || [];
  return results.slice(0, 8).map((r) => ({
    title: r.title,
    url: r.link || r.url,
    snippet: r.snippet || r.description || "",
  }));
}

// ---------- URL fetch (simple public pages) ----------

export async function fetchUrlText(url, signal) {
  const resp = await fetch(url, {
    method: "GET",
    signal,
    headers: { Accept: "text/html,text/plain,*/*" },
  });
  if (!resp.ok) throw new Error(`Fetch ${url} failed: HTTP ${resp.status}`);
  const text = await resp.text();
  return extractTextFromHtml(text).slice(0, 12000);
}

function extractTextFromHtml(html) {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = doc.querySelectorAll("script, style, nav, footer, header, aside");
  scripts.forEach((el) => el.remove());
  return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
}
