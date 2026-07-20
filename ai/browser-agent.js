// browser-agent.js — AI-driven browser control agent for ChatAI PWA.
// Uses fetch-based page content extraction (not iframe DOM access) for cross-origin support.
// The iframe is for visual display only; the AI "sees" pages via fetch-based text extraction.

import { parseToolCalls, stripToolCalls } from "./tool-parser.js";

const MAX_ITERATIONS = 8;

function buildBrowserToolPrompt() {
  return `You are a browser control agent. You can navigate websites, read page content, extract links and forms, and submit form data.

Available tools (emit raw XML only, no markdown fences):

1. Navigate to a URL:
<tool name="navigate"><url>https://example.com</url></tool>

2. Get the current page text content:
<tool name="get_page_text"></tool>

3. Extract all links from the current page (returns URL and text for each):
<tool name="extract_links"></tool>

4. Extract all forms from the current page (returns form action, method, and all input fields):
<tool name="extract_forms"></tool>

5. Get structured page content (headings with their sections):
<tool name="get_page_structure"></tool>

6. Click a link by its URL or visible text:
<tool name="click_link"><url>https://example.com/page</url></tool>
(OR)
<tool name="click_link"><text>link text</text></tool>

7. Fill a form field (by field name or label):
<tool name="fill_form"><field>username</field><value>myuser</value></tool>

8. Submit a form (by form index, default 0):
<tool name="submit_form"><index>0</index></tool>

9. Finish the task and return a final answer:
<tool name="done"><message>Summary of what you did and what you found.</message></tool>

Rules:
- Always navigate to a page first before trying to extract content.
- After navigating, use get_page_text or extract_links/extract_forms to understand the page.
- For login/signup flows: navigate to the page, extract forms, fill fields, submit.
- For clicking: use click_link with the URL or visible text of the link.
- When you are finished, emit <tool name="done">.
- Do not wrap tool blocks in markdown or code blocks; emit raw XML only.
- The iframe shows the page visually; you see pages via fetch-based text extraction.`;
}

export function buildBrowserSystemPrompt(agentPrompt, memoryContext = "") {
  let prompt = buildBrowserToolPrompt();
  if (agentPrompt?.trim()) {
    prompt += "\n\n" + agentPrompt.trim();
  }
  if (memoryContext?.trim()) {
    prompt += "\n\n" + memoryContext.trim();
  }
  return prompt;
}

function extractText(msg) {
  if (typeof msg === "string") return msg;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.filter((p) => p?.type === "text").map((p) => p.text || "").join("\n");
  }
  return "";
}

function normalizeUrl(url, baseUrl) {
  if (!url || !url.trim()) return null;
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith("/") && baseUrl) {
      try {
        const base = new URL(baseUrl);
        return base.origin + url;
      } catch {}
    }
    return "https://" + url;
  }
  return url;
}

async function parsePageHtml(url, signal) {
  const resp = await fetch(url, {
    method: "GET",
    signal,
    headers: { Accept: "text/html,text/plain,*/*" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const title = doc.title || "";

  // Extract visible text (strip scripts, styles, nav, footer, header, aside)
  const scripts = doc.querySelectorAll("script, style, nav, footer, header, aside");
  scripts.forEach((el) => el.remove());
  const pageText = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();

  // Extract links
  const links = [];
  const anchors = doc.querySelectorAll("a[href]");
  anchors.forEach((a) => {
    const href = a.getAttribute("href");
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      links.push({ url: href, text: (a.textContent || "").trim().slice(0, 100) });
    }
  });

  // Extract forms
  const forms = [];
  doc.querySelectorAll("form").forEach((form) => {
    const fields = [];
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const name = el.name || el.id;
      if (name) {
        const label =
          form.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ||
          el.placeholder ||
          name;
        fields.push({
          name,
          type: el.type || "text",
          label,
          value: el.value || "",
          required: !!el.required,
        });
      }
    });
    forms.push({
      action: form.action || url,
      method: (form.method || "get").toLowerCase(),
      fields,
      defaults: Object.fromEntries(
        fields.filter((f) => f.value).map((f) => [f.name, f.value])
      ),
    });
  });

  // Extract structured content (headings + paragraphs)
  const sections = [];
  const headings = doc.querySelectorAll("h1, h2, h3, h4");
  headings.forEach((h) => {
    const headingText = (h.textContent || "").trim();
    if (!headingText) return;
    let sectionText = "";
    let el = h.nextElementSibling;
    while (el && !/^h[1-4]$/i.test(el.tagName)) {
      if (el.tagName === "P" || el.tagName === "LI" || el.tagName === "BLOCKQUOTE") {
        sectionText += (el.textContent || "").trim() + " ";
      }
      el = el.nextElementSibling;
    }
    sections.push({ heading: headingText, text: sectionText.trim() });
  });

  return { title, pageText, links, forms, sections };
}

async function submitForm(form, data, signal) {
  if (form.method === "get") {
    const url = new URL(form.action);
    Object.entries(data).forEach(([k, v]) => url.searchParams.set(k, v));
    const resp = await fetch(url.toString(), {
      method: "GET",
      signal,
      headers: { Accept: "text/html,*/*" },
      redirect: "follow",
    });
    const text = await resp.text();
    return { status: resp.status, url: resp.url, text };
  } else {
    const body = new URLSearchParams();
    Object.entries(data).forEach(([k, v]) => body.set(k, v));
    const resp = await fetch(form.action, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,*/*",
      },
      body: body.toString(),
      redirect: "follow",
    });
    const text = await resp.text();
    return { status: resp.status, url: resp.url, text };
  }
}

function formatForms(forms) {
  if (!forms.length) return "No forms found on this page.";
  return forms
    .map((f, i) => {
      const fields = f.fields
        .map((fd) => `  - ${fd.name} (${fd.type})${fd.required ? " [required]" : ""}: ${fd.label}`)
        .join("\n");
      return `Form #${i}: action="${f.action}" method="${f.method}"\n${fields}`;
    })
    .join("\n\n");
}

function formatSections(sections) {
  if (!sections || !sections.length) return "No structured content found on this page.";
  return sections
    .map((s, i) => `Section ${i + 1}: ${s.heading}\n${s.text.slice(0, 500)}`)
    .join("\n\n");
}

async function executeBrowserTool({ name, args }, browserState, onProgress, signal) {
  switch (name) {
    case "navigate": {
      const url = normalizeUrl(args.url, browserState.currentUrl);
      if (!url) return "Error: invalid URL";

      // Navigate the iframe for visual display
      if (browserState.navigateIframe) browserState.navigateIframe(url);

      // Fetch and parse the page
      let pageData;
      try {
        pageData = await parsePageHtml(url, signal);
      } catch (e) {
        return `Error: Could not fetch page content from ${url}. ${e.message || e}`;
      }

      browserState.currentUrl = url;
      browserState.lastFetchedUrl = url;
      browserState.pageText = pageData.pageText;
      browserState.pageLinks = pageData.links;
      browserState.pageForms = pageData.forms;
      browserState.pageTitle = pageData.title;

      if (onProgress) {
        onProgress({
          type: "navigate",
          url,
          title: pageData.title,
          textLength: pageData.pageText.length,
          pageText: pageData.pageText,
        });
      }

      const preview = pageData.pageText.slice(0, 8000);
      return `Navigated to ${url}\nTitle: ${pageData.title}\n\nPage content (first 8000 chars):\n${preview}`;
    }

    case "get_page_text": {
      if (!browserState.currentUrl) return "Error: no page loaded. Navigate to a URL first.";

      // Use cached data if available and URL hasn't changed
      if (browserState.pageText && browserState.lastFetchedUrl === browserState.currentUrl) {
        if (onProgress) {
          onProgress({
            type: "get_page_text",
            url: browserState.currentUrl,
            length: browserState.pageText.length,
            cached: true,
            pageText: browserState.pageText,
          });
        }
        return browserState.pageText.slice(0, 25000);
      }

      let pageData;
      try {
        pageData = await parsePageHtml(browserState.currentUrl, signal);
      } catch (e) {
        return `Error: Could not fetch page content. ${e.message || e}`;
      }
      browserState.pageText = pageData.pageText;
      browserState.pageLinks = pageData.links;
      browserState.pageForms = pageData.forms;
      browserState.pageTitle = pageData.title;
      browserState.lastFetchedUrl = browserState.currentUrl;

      if (onProgress) {
        onProgress({
          type: "get_page_text",
          url: browserState.currentUrl,
          length: pageData.pageText.length,
          pageText: pageData.pageText,
        });
      }
      return pageData.pageText.slice(0, 25000);
    }

    case "extract_links": {
      if (!browserState.currentUrl) return "Error: no page loaded.";

      // Use cached links if available and URL hasn't changed
      if (browserState.pageLinks.length && browserState.lastFetchedUrl === browserState.currentUrl) {
        if (onProgress) {
          onProgress({
            type: "extract_links",
            url: browserState.currentUrl,
            count: browserState.pageLinks.length,
            cached: true,
          });
        }
        if (!browserState.pageLinks.length) return "No links found on this page.";
        return browserState.pageLinks
          .map((l, i) => `${i + 1}. [${l.text}](${l.url})`)
          .join("\n");
      }

      let pageData;
      try {
        pageData = await parsePageHtml(browserState.currentUrl, signal);
      } catch (e) {
        return `Error: Could not fetch page content. ${e.message || e}`;
      }
      browserState.pageLinks = pageData.links;
      browserState.lastFetchedUrl = browserState.currentUrl;

      if (onProgress) {
        onProgress({
          type: "extract_links",
          url: browserState.currentUrl,
          count: pageData.links.length,
        });
      }
      if (!pageData.links.length) return "No links found on this page.";
      return pageData.links
        .map((l, i) => `${i + 1}. [${l.text}](${l.url})`)
        .join("\n");
    }

    case "extract_forms": {
      if (!browserState.currentUrl) return "Error: no page loaded.";

      // Use cached forms if available and URL hasn't changed
      if (browserState.pageForms.length && browserState.lastFetchedUrl === browserState.currentUrl) {
        if (onProgress) {
          onProgress({
            type: "extract_forms",
            url: browserState.currentUrl,
            count: browserState.pageForms.length,
            cached: true,
          });
        }
        return formatForms(browserState.pageForms);
      }

      let pageData;
      try {
        pageData = await parsePageHtml(browserState.currentUrl, signal);
      } catch (e) {
        return `Error: Could not fetch page content. ${e.message || e}`;
      }
      browserState.pageForms = pageData.forms;
      browserState.lastFetchedUrl = browserState.currentUrl;

      if (onProgress) {
        onProgress({
          type: "extract_forms",
          url: browserState.currentUrl,
          count: pageData.forms.length,
        });
      }
      return formatForms(pageData.forms);
    }

    case "get_page_structure": {
      if (!browserState.currentUrl) return "Error: no page loaded.";

      // Use cached data if available
      if (browserState.pageSections && browserState.lastFetchedUrl === browserState.currentUrl) {
        if (onProgress) {
          onProgress({
            type: "get_page_structure",
            url: browserState.currentUrl,
            count: browserState.pageSections.length,
            cached: true,
          });
        }
        return formatSections(browserState.pageSections);
      }

      let pageData;
      try {
        pageData = await parsePageHtml(browserState.currentUrl, signal);
      } catch (e) {
        return `Error: Could not fetch page content. ${e.message || e}`;
      }
      browserState.pageSections = pageData.sections;
      browserState.lastFetchedUrl = browserState.currentUrl;

      if (onProgress) {
        onProgress({
          type: "get_page_structure",
          url: browserState.currentUrl,
          count: pageData.sections.length,
        });
      }
      return formatSections(pageData.sections);
    }

    case "click_link": {
      const clickUrl = args.url;
      const clickText = args.text;
      if (!clickUrl && !clickText) return "Error: provide either url or text";

      let targetUrl;
      if (clickUrl) {
        targetUrl = normalizeUrl(clickUrl, browserState.currentUrl);
      } else {
        // Find link by text on the current page
        let pageData;
        try {
          pageData = await parsePageHtml(browserState.currentUrl, signal);
        } catch (e) {
          return `Error: Could not fetch page content. ${e.message || e}`;
        }
        const match = pageData.links.find((l) =>
          l.text.toLowerCase().includes(clickText.toLowerCase())
        );
        if (!match) return `Error: no link found containing "${clickText}" on the current page.`;
        targetUrl = normalizeUrl(match.url, browserState.currentUrl);
      }

      if (!targetUrl) return "Error: could not resolve target URL";

      // Navigate the iframe
      if (browserState.navigateIframe) browserState.navigateIframe(targetUrl);

      // Fetch and parse the target page
      let pageData;
      try {
        pageData = await parsePageHtml(targetUrl, signal);
      } catch (e) {
        return `Error: Could not fetch page content from ${targetUrl}. ${e.message || e}`;
      }

      browserState.currentUrl = targetUrl;
      browserState.lastFetchedUrl = targetUrl;
      browserState.pageText = pageData.pageText;
      browserState.pageLinks = pageData.links;
      browserState.pageForms = pageData.forms;
      browserState.pageTitle = pageData.title;

      if (onProgress) {
        onProgress({ type: "click_link", url: targetUrl, title: pageData.title });
      }

      const preview = pageData.pageText.slice(0, 8000);
      return `Clicked link, navigated to ${targetUrl}\nTitle: ${pageData.title}\n\nPage content (first 8000 chars):\n${preview}`;
    }

    case "fill_form": {
      const field = args.field;
      const value = args.value;
      if (!field) return "Error: missing field name";
      if (!browserState.pendingFormData) browserState.pendingFormData = {};
      browserState.pendingFormData[field] = value || "";

      if (onProgress) {
        onProgress({ type: "fill_form", field, value: value || "" });
      }
      return `Set field "${field}" to "${value || ""}"`;
    }

    case "submit_form": {
      const index = parseInt(args.index || "0", 10);
      if (!browserState.pageForms || !browserState.pageForms[index]) {
        return `Error: form index ${index} not found. Use extract_forms first to see available forms.`;
      }
      const form = browserState.pageForms[index];
      const formData = { ...form.defaults, ...(browserState.pendingFormData || {}) };

      let result;
      try {
        result = await submitForm(form, formData, signal);
      } catch (e) {
        return `Error: Form submission failed. ${e.message || e}`;
      }

      // Navigate iframe to the result URL
      const resultUrl = result.url || form.action;
      if (resultUrl) {
        if (browserState.navigateIframe) browserState.navigateIframe(resultUrl);
        try {
          const pageData = await parsePageHtml(resultUrl, signal);
          browserState.currentUrl = resultUrl;
          browserState.lastFetchedUrl = resultUrl;
          browserState.pageText = pageData.pageText;
          browserState.pageLinks = pageData.links;
          browserState.pageForms = pageData.forms;
          browserState.pageTitle = pageData.title;
        } catch {
          // If we can't parse the result page, just update the URL
          browserState.currentUrl = resultUrl;
        }
      }

      browserState.pendingFormData = {};

      if (onProgress) {
        onProgress({ type: "submit_form", url: form.action, result: result.status });
      }

      const responsePreview = (result.text || "").slice(0, 8000);
      return `Form submitted. Status: ${result.status}\nResponse URL: ${resultUrl || "unknown"}\n\nResponse content:\n${responsePreview}`;
    }

    case "done": {
      return "done";
    }

    default:
      return `Error: unknown tool "${name}"`;
  }
}

export async function runBrowserAgentLoop({
  callConnection,
  connection,
  messages,
  systemPrompt,
  signal,
  onProgress,
  onToken,
  browserState,
}) {
  // Build history from recent messages
  const history = [];
  const recentContext = messages.slice(-6);
  for (const m of recentContext) {
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role, content: extractText(m) });
    }
  }
  // Ensure we always end with a user message
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    const userMsg = messages[messages.length - 1];
    history.push({ role: "user", content: extractText(userMsg) });
  }

  let iteration = 0;
  let totalUsage = { total_tokens: 0 };

  while (iteration < MAX_ITERATIONS) {
    if (signal?.aborted) throw new Error("aborted");
    iteration++;

    const apiMessages = [];
    apiMessages.push({ role: "system", content: systemPrompt });
    for (const m of history) apiMessages.push(m);

    const { content, usage } = await callConnection(connection, apiMessages, null, signal, {
      stream: true,
      onToken,
    });
    if (usage?.total_tokens) {
      totalUsage.total_tokens += usage.total_tokens;
    }

    const toolCalls = parseToolCalls(content);

    if (!toolCalls.length) {
      // No tool calls — treat the response as the final answer
      return { final: content, actions: [], usage: totalUsage };
    }

    const results = [];
    for (const call of toolCalls) {
      if (signal?.aborted) throw new Error("aborted");
      const result = await executeBrowserTool(call, browserState, onProgress, signal);
      results.push({ call, result });

      if (call.name === "done") {
        return {
          final: call.args.message || stripToolCalls(content),
          actions: results.slice(0, -1),
          usage: totalUsage,
        };
      }
    }

    // Build tool-result message for the next iteration
    const resultText = results
      .map(({ call, result }) => {
        return `<tool_result name="${call.name}">${result}</tool_result>`;
      })
      .join("\n");

    history.push({ role: "assistant", content });
    history.push({ role: "user", content: resultText });

    // Cap history to prevent unbounded growth.
    // Keep the first user message (the original request) and the last 6 messages (3 exchanges).
    if (history.length > 8) {
      const firstUser = history[0];
      const recent = history.slice(-6);
      history.length = 0;
      history.push(firstUser);
      for (const m of recent) history.push(m);
    }

    if (onProgress) {
      onProgress({ iteration, total: results.length, results });
      onProgress({ type: "thinking", iteration, maxIterations: MAX_ITERATIONS });
    }
  }

  throw new Error(`Browser agent loop did not finish within ${MAX_ITERATIONS} iterations`);
}
