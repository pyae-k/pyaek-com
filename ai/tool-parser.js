// tool-parser.js — shared XML/JSON tool call parser for ChatAI PWA agents.
// Used by both agent-loop.js (folder agent) and browser-agent.js (browser agent).
// Handles N parameters, any order, CDATA, markdown fences, and JSON fallback.

// Outer regex: captures tool name and full inner content
const TOOL_RE = /<\s*tool\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\s*\/\s*tool\s*>/gi;

// Inner regex: captures any <paramName>value</paramName> pair
const PARAM_RE = /<\s*([a-zA-Z_][\w.-]*)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/g;

function stripCdata(s) {
  if (s.startsWith("<![CDATA[") && s.endsWith("]]>")) {
    return s.slice(9, -3);
  }
  return s;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripMarkdownFences(text) {
  return text
    .replace(/```(?:xml)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/~~~(?:xml)?\s*([\s\S]*?)~~~/gi, "$1");
}

function parseXmlToolCalls(text) {
  const calls = [];
  let match;
  TOOL_RE.lastIndex = 0;
  while ((match = TOOL_RE.exec(text)) !== null) {
    const name = match[1];
    const inner = match[2];
    const args = {};
    let paramMatch;
    PARAM_RE.lastIndex = 0;
    while ((paramMatch = PARAM_RE.exec(inner)) !== null) {
      args[paramMatch[1]] = decodeXmlEntities(stripCdata(paramMatch[2].trim()));
    }
    calls.push({ name, args });
  }
  return calls;
}

function parseJsonToolCalls(text) {
  // Try to find JSON tool call objects in the text
  const jsonPattern = /\{(?:[^{}]|"(?:[^"\\]|\\.)*")*\}/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      // Support both {"tool": "...", "args": {...}} and {"name": "...", "arguments": {...}}
      const name = obj.tool || obj.name;
      const args = obj.args || obj.arguments || {};
      if (name && typeof name === "string") {
        return [{ name, args }];
      }
    } catch {}
  }
  return [];
}

/**
 * Parse tool calls from AI response text.
 * Tries three strategies in order:
 * 1. XML parsing (primary) — handles N params, any order, CDATA
 * 2. Markdown fence stripping — retries XML after removing ```xml fences
 * 3. JSON fallback — finds {"tool": "...", "args": {...}} objects
 */
export function parseToolCalls(text) {
  if (!text) return [];

  // Strategy 1: XML parsing
  let calls = parseXmlToolCalls(text);
  if (calls.length > 0) return calls;

  // Strategy 2: Strip markdown fences and retry XML
  const unfenced = stripMarkdownFences(text);
  if (unfenced !== text) {
    calls = parseXmlToolCalls(unfenced);
    if (calls.length > 0) return calls;
  }

  // Strategy 3: JSON fallback
  return parseJsonToolCalls(text);
}

/**
 * Strip all <tool>...</tool> blocks from text, returning the remaining content.
 */
export function stripToolCalls(text) {
  return text.replace(TOOL_RE, "").trim();
}

export { TOOL_RE };
