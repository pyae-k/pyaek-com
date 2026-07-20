// agent-loop.js — autonomous multi-step coding/writing/research agent for OpenChatbox.
// Works with any OpenAI-compatible endpoint by asking the model to emit XML tool tags.

import { generateImage, searchWeb, fetchUrlText } from "./tools.js";
import { embedQuery, searchKnowledgeBase } from "./rag.js";
import { parseToolCalls, stripToolCalls } from "./tool-parser.js";

const MAX_ITERATIONS = 8;

function buildToolPrompt(toolConfig) {
  const cfg = toolConfig || {};
  const extras = [];
  if (cfg.webSearch) extras.push(`7. Web search (when the user needs current or external information):
<tool name="web_search"><query>search query</query></tool>`);
  if (cfg.imageGen) extras.push(`8. Generate an image:
<tool name="generate_image"><prompt>detailed image description</prompt></tool>`);
  if (cfg.fetchUrl) extras.push(`9. Fetch a public URL and read its text:
<tool name="fetch_url"><url>https://example.com/article</url></tool>`);
  if (cfg.kbSearch) extras.push(`10. Search the user's knowledge base:
<tool name="read_kb"><query>question about uploaded documents</query></tool>`);

  return `You are an autonomous assistant. A folder or file is LINKED to this conversation and you ALREADY HAVE PERMISSION to access it.

HARD RULE — FOLLOW IT EXACTLY:
- Whenever the user asks anything about the linked folder or file (contents, count, edit, create, search, read, write, list, exists, etc.), you MUST use one of the file tools below FIRST.
- Do NOT answer from memory. Do NOT guess. Do NOT assume.
- Do NOT say "I checked", "I have checked", "I can see", "I cannot see", "I cannot access", "I do not have permission", "there is no folder", "the folder is empty", "currently empty", "no files visible", "I am not linked", or similar. Those are wrong — access is granted and you MUST verify by calling a tool.
- For yes/no questions, use a tool to verify first, then answer based on the tool result.
- Start your response with the XML tool block(s). Put any explanation AFTER the tool blocks, not before.
- If the request is about the linked location, output ONLY the tool block(s) in your first response. Wait for the tool result, then answer.
- If you are unsure whether a path exists, use list_dir or read_file to confirm before answering.

Available tools (emit raw XML only, no markdown fences):

1. List a directory:
<tool name="list_dir"><path>.</path></tool>

2. Read a text file (max 1 MB):
<tool name="read_file"><path>relative/path</path></tool>

3. Write or overwrite a text file:
<tool name="write_file"><path>relative/path</path><content><![CDATA[
file content here
]]></content></tool>

4. Apply a unified diff patch to a text file:
<tool name="apply_patch"><path>relative/path</path><diff><![CDATA[
@@ -1,3 +1,3 @@
 old line
-new line
+new line
 context line
]]></diff></tool>

5. Search file contents (substring or /regex/flags):
<tool name="search_files"><query>search term</query></tool>

6. Finish the task and return a final answer:
<tool name="done"><message>Summary of what you did, plus any follow-up questions.</message></tool>
${extras.join("\n\n")}

Rules:
- For ANY request about the linked folder or file, first list or read the relevant files, then answer or edit.
- Use relative paths from the linked root. For a linked file, use its name or "." as the path.
- If the user asks you to create a file and the path is not specified, pick a sensible path.
- Prefer apply_patch for small edits; use write_file for new files or complete rewrites.
- When you are finished, emit <tool name="done">.
- Do not wrap tool blocks in markdown or code blocks; emit raw XML only.

Examples:

User: "How many files are in the folder?"
Your response:
<tool name="list_dir"><path>.</path></tool>

User: "what file are include in pyaek"
Your response:
<tool name="list_dir"><path>.</path></tool>

User: "Read README.md"
Your response:
<tool name="read_file"><path>README.md</path></tool>

User: "Create a blank file named blank.md"
Your response:
<tool name="write_file"><path>blank.md</path><content><![CDATA[
]]></content></tool>

${cfg.webSearch ? `User: "What is the latest version of React?"
Your response:
<tool name="web_search"><query>latest React version</query></tool>

` : ""}${cfg.imageGen ? `User: "Create an image of a cat in space"
Your response:
<tool name="generate_image"><prompt>a cute cat floating in space with stars and nebula, digital art</prompt></tool>

` : ""}${cfg.kbSearch ? `User: "What do my notes say about the budget?"
Your response:
<tool name="read_kb"><query>budget</query></tool>

` : ""}REMEMBER: if the question is about the linked location, your first response must contain ONLY a tool XML block. No natural-language answer before calling a tool.
`;
}

export { parseToolCalls };

export function buildFolderSystemPrompt(agentPrompt, folderName, filePath, toolConfig) {
  let locationLine;
  if (filePath) {
    locationLine = `Connected file: ${filePath}. Use read_file/write_file with path "${filePath}" or "." to access it.`;
  } else {
    locationLine = `Connected folder: ${folderName || "project"}. Use list_dir/read_file/write_file/apply_patch/search_files with relative paths inside this folder.`;
  }
  return `${buildToolPrompt(toolConfig)}\n\n${locationLine}\n\n${agentPrompt || ""}`.trim();
}

// Heuristics to detect when the user is asking about the linked folder/file.
function isFolderQuery(content) {
  const text = String(content || "");
  const folderTerms = [
    /\bfiles?\b/i, /\bfolders?\b/i, /\bdirector(ies|y)\b/i, /\bdirs?\b/i, /\bpaths?\b/i,
    /\bcontents?\b/i, /\binside\b/i, /\bincluded?\b/i,
    /\bwhat(\s*'s|\s+is|\s+are)?\s+in\b/i, /\blist\b/i, /\bshow\s+me\b/i, /\bshow\s+the\b/i,
    /\bread\b/i, /\bwrite\b/i, /\bedit\b/i, /\bcreate\b/i, /\bdelete\b/i, /\bsearch\b/i, /\bfind\b/i,
    /\blook\s+(at|in)\b/i, /\bcheck\b/i, /\btell\s+me\s+about\b/i, /\bdescribe\b/i,
    /\bhow\s+many\b/i, /\bis\s+there\b/i, /\bare\s+there\b/i, /\bdoes\s+it\s+have\b/i,
  ];
  return folderTerms.some((term) => term.test(text));
}

// Detect answers that look like they came from memory rather than a tool result.
function looksLikeHallucination(content) {
  const lower = String(content || "").toLowerCase();
  const hallucinationPhrases = [
    "i have checked",
    "i checked",
    "i can see",
    "i cannot see",
    "currently empty",
    "no files visible",
    "no files listed",
    "there are no files",
    "there is no folder",
    "folder might be empty",
    "might currently be empty",
    "i do not have permission",
    "i don't have permission",
    "i am not linked",
    "i'm not linked",
    "cannot access",
    "can't access",
    "do not have access",
    "don't have access",
    "not available to me",
    "properly saved or uploaded",
  ];
  if (!hallucinationPhrases.some((phrase) => lower.includes(phrase))) return false;
  // Avoid false positives for non-file topics (e.g. "I checked the weather").
  // Require the response to actually reference files, folders, or access.
  const folderContext = /\b(folder|folders|file|files|directory|directories|dir|dirs|path|paths|project|upload|uploaded|save|saved|access|linked|permission|permissions|visible|listed|empty)\b/i;
  return folderContext.test(lower);
}

export async function runAgentLoop({
  fs,
  callConnection,
  connection,
  messages,
  systemPrompt,
  signal,
  onProgress,
  onToken,
  toolConfig,
}) {
  if (!fs?.connected) throw new Error("No folder connected");

  // Include the last several user/assistant messages for conversational context.
  const history = [];
  const recentContext = messages.slice(-6);
  for (const m of recentContext) {
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role, content: extractText(m) });
    }
  }
  // Ensure we always end with a user message for the current turn.
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    const userMsg = messages[messages.length - 1];
    history.push({ role: "user", content: extractText(userMsg) });
  }

  // Inject a strong reminder into the current user turn so small/local models
  // cannot ignore the tool instructions.
  const last = history[history.length - 1];
  const originalUserContent = last && last.role === "user" ? extractText(last.content) : "";
  if (last && last.role === "user") {
    last.content = injectToolReminder(last.content);
  }

  let iteration = 0;
  let autoListDone = false;
  let totalUsage = { total_tokens: 0 };
  while (iteration < MAX_ITERATIONS) {
    if (signal?.aborted) throw new Error("aborted");
    iteration++;

    const apiMessages = [];
    apiMessages.push({ role: "system", content: systemPrompt });
    for (const m of history) apiMessages.push(m);

    const { content, usage } = await callConnection(connection, apiMessages, null, signal, { stream: true, onToken });
    if (usage?.total_tokens) {
      totalUsage.total_tokens += usage.total_tokens;
    }
    const toolCalls = parseToolCalls(content);

    if (!toolCalls.length) {
      // Fallback: some models ignore the tool instructions and answer from memory.
      // If the user asked about the linked location, force a list_dir so the model
      // has real data before answering. Only do this once per turn.
      const shouldAutoList = !autoListDone && (isFolderQuery(originalUserContent) || looksLikeHallucination(content));
      if (shouldAutoList) {
        autoListDone = true;
        const call = { name: "list_dir", args: { path: "." } };
        const result = await executeTool(fs, call, onProgress, toolConfig);
        const fakeToolCall = `<tool name="list_dir"><path>.</path></tool>`;
        const resultText = `<tool_result name="list_dir">${result}</tool_result>`;
        history.push({ role: "assistant", content: fakeToolCall });
        history.push({ role: "user", content: resultText });
        continue;
      }
      // No tool calls and no fallback; treat the whole response as the final answer.
      return { final: content, actions: [], streamed: true, usage: totalUsage };
    }

    const results = [];
    for (const call of toolCalls) {
      if (signal?.aborted) throw new Error("aborted");
      const res = await executeTool(fs, call, onProgress, toolConfig);
      results.push({ call, result: res });
      if (call.name === "done") {
        return {
          final: call.args.message || stripToolCalls(content),
          actions: results.slice(0, -1),
          streamed: true,
          usage: totalUsage,
        };
      }
    }

    // Build tool-result message for the next iteration.
    const resultText = results
      .map(({ call, result }) => {
        if (call.name === "write_file") return `<tool_result name="${call.name}" path="${call.args.path}">${result}</tool_result>`;
        if (call.name === "apply_patch") return `<tool_result name="${call.name}" path="${call.args.path}">${result}</tool_result>`;
        return `<tool_result name="${call.name}">${result}</tool_result>`;
      })
      .join("\n");

    history.push({ role: "assistant", content: content });
    history.push({ role: "user", content: resultText });

    if (onProgress) {
      onProgress({ iteration, total: results.length, results });
    }
  }

  throw new Error(`Agent loop did not finish within ${MAX_ITERATIONS} iterations`);
}

async function executeTool(fs, { name, args }, onProgress, toolConfig) {
  const cfg = toolConfig || {};
  switch (name) {
    case "list_dir": {
      const path = args.path || ".";
      const entries = await fs.list(path, false);
      if (onProgress) onProgress({ type: "list", path, count: entries.length, entries });
      return formatList(entries);
    }
    case "read_file": {
      const path = args.path;
      if (!path) return "Error: missing path";
      const text = await fs.readText(path);
      if (onProgress) onProgress({ type: "read", path, size: text.length, snippet: text.slice(0, 1200) });
      return `\n\n${text}\n\n`;
    }
    case "write_file": {
      const path = args.path;
      const content = args.content || "";
      if (!path) return "Error: missing path";
      await fs.writeText(path, content);
      if (onProgress) onProgress({ type: "write", path, content });
      return `Wrote ${path} (${content.length} bytes)`;
    }
    case "apply_patch": {
      const path = args.path;
      const diff = args.diff || "";
      if (!path) return "Error: missing path";
      const patched = await fs.applyPatch(path, diff);
      if (onProgress) onProgress({ type: "patch", path, diff });
      return `Patched ${path}. New length ${patched.length} bytes.`;
    }
    case "search_files": {
      const query = args.query;
      if (!query) return "Error: missing query";
      const hits = await fs.search(".", query);
      if (onProgress) onProgress({ type: "search", query, count: hits.length, hits });
      return formatSearch(hits);
    }
    case "web_search": {
      const query = args.query;
      if (!query) return "Error: missing query";
      if (!cfg.webSearch) return "Error: web search not configured";
      try {
        const results = await searchWeb(cfg.webSearch, query);
        const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);
        if (onProgress) onProgress({ type: "web_search", query, count: results.length });
        return lines.join("\n\n") || "No results.";
      } catch (e) {
        return `Error: ${e.message || e}`;
      }
    }
    case "generate_image": {
      const prompt = args.prompt;
      if (!prompt) return "Error: missing prompt";
      if (!cfg.imageGen) return "Error: image generation not configured";
      try {
        const url = await generateImage(cfg.imageGen, prompt);
        if (onProgress) onProgress({ type: "generate_image", prompt, url });
        return `Image generated: ${url}`;
      } catch (e) {
        return `Error: ${e.message || e}`;
      }
    }
    case "fetch_url": {
      const url = args.url;
      if (!url) return "Error: missing url";
      if (!cfg.fetchUrl) return "Error: URL fetch not enabled";
      try {
        const text = await fetchUrlText(url);
        if (onProgress) onProgress({ type: "fetch_url", url, length: text.length });
        return text;
      } catch (e) {
        return `Error: ${e.message || e}`;
      }
    }
    case "read_kb": {
      const query = args.query;
      if (!query) return "Error: missing query";
      if (!cfg.kbSearch) return "Error: knowledge base search not configured";
      try {
        const embedding = await embedQuery(cfg.kbSearch.connection, query);
        const results = await searchKnowledgeBase(embedding, cfg.kbSearch.topK);
        const lines = results.map((r, i) => `[${i + 1}] ${r.fileName}\n${r.chunkText}`);
        if (onProgress) onProgress({ type: "read_kb", query, count: results.length });
        return lines.join("\n\n") || "No relevant excerpts found.";
      } catch (e) {
        return `Error: ${e.message || e}`;
      }
    }
    case "done": {
      return "done";
    }
    default:
      return `Error: unknown tool "${name}"`;
  }
}

function formatList(entries) {
  if (!entries.length) return "(empty directory)";
  return entries.map((e) => `${e.kind === "directory" ? "📁" : "📄"} ${e.name}${e.size != null ? ` (${formatBytes(e.size)})` : ""}`).join("\n");
}

function formatSearch(hits) {
  if (!hits.length) return "No matches found.";
  return hits
    .map((h) => `File: ${h.path}\n` + h.matches.map((m) => `  ${m.line}: ${m.text}`).join("\n"))
    .join("\n\n");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function extractText(msg) {
  if (typeof msg === "string") return msg;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.filter((p) => p?.type === "text").map((p) => p.text || "").join("\n");
  }
  return "";
}

function injectToolReminder(content) {
  const reminder = " [Use the linked file tools to answer. Do not say you cannot access files — access is already granted.]";
  if (typeof content === "string") {
    return content.trim() ? content + reminder : reminder.trim();
  }
  if (Array.isArray(content)) {
    const textParts = content.filter((p) => p?.type === "text");
    if (textParts.length > 0) {
      const last = textParts[textParts.length - 1];
      last.text = (last.text || "").trim() ? last.text + reminder : reminder.trim();
    } else {
      content.push({ type: "text", text: reminder.trim() });
    }
    return content;
  }
  return reminder.trim();
}
