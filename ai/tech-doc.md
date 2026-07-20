# ChatAI — Technical Documentation

## Architecture Overview

ChatAI is a **zero-backend, offline-first** AI chat PWA. Everything runs in the
browser — conversations, settings, API keys, and even vector embeddings for RAG
are stored locally in **IndexedDB** and **localStorage**. AI API requests go
directly from the browser to the configured endpoint; there is no intermediary
server, no analytics, and no accounts.

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| **No backend** | Zero infrastructure to maintain. Deploy to any static host (GitHub Pages, Netlify, S3). |
| **IndexedDB for storage** | Survives browser restarts, handles large conversations, supports object stores for different data types. |
| **localStorage for settings** | Simple key-value for small, frequently-read settings (active connection, preferences). |
| **ES modules** | All JS files use `import`/`export` — no bundler needed. The browser loads them directly. |
| **Service worker precache** | App shell (HTML, CSS, JS, icons) loads offline. Only AI API calls need network. |
| **No build step** | Edit files and reload. Deploy by pushing to a static host. |

---

## Module Breakdown

### `index.html` — App shell
The entire UI is a single HTML file containing:
- **Topbar**: brand, network status, online toggle, import/export, documentation buttons, contact, settings
- **Sidebar**: chat list with search, project panel (when a folder is linked)
- **Chat area**: messages view, browser panel (split view), composer with connection/agent selects
- **Dialogs**: settings, add-connection, add-agent, link-folder, file-preview

### `app.js` — Main application logic (~119KB)
The central module that imports and wires everything together:

- **Storage layer**: IndexedDB CRUD for conversations (`dbAll`, `dbPut`, `dbDelete`, `dbClear`)
- **Settings management**: load/save from localStorage, migration from v1/v2 formats
- **Conversation management**: create, rename, delete, set active, search
- **Chat rendering**: `renderChatList()` for sidebar, `renderMessages()` for chat view
- **Streaming**: SSE-based token-by-token display with cursor animation
- **Flow routing**: `sendMessage()` routes to the appropriate flow based on task detection:
  - `runChatFlow` — standard chat
  - `runImageFlow` — image generation (DALL-E, Stability AI)
  - `runSearchFlow` — web search (Tavily, Brave, SerpApi)
  - `runKBFlow` — knowledge base RAG
  - `runFolderFlow` — agentic folder/file coding
  - `runBrowserFlow` — browser agent
- **Voice UI**: recording bar, mic button toggle, Web Speech API integration
- **Attachment handling**: file picker, preview chips, document text extraction
- **Import/export**: JSON backup/restore, HTML chat export

### `providers.js` — Connection and agent presets
Defines 40+ API connection templates (Ollama, OpenAI, Anthropic, Gemini, etc.)
with default endpoints, models, tags, and accent colors. Also defines the 9
default agent presets (Auto, Minimal, Bullet, Table, Research, Max, Coding,
PWA, Image).

### `model-router.js` — API routing and streaming
- Connection selection and scoring by task type
- Normalizes requests for different providers (Anthropic, Azure, standard OpenAI-compatible)
- Handles streaming SSE parsing and non-streaming responses
- Implements fallback logic (retry with next-best connection on failure)

### `browser-agent.js` — Browser control agent
An AI-driven browser agent that uses **fetch-based page content extraction**
(rather than iframe DOM access) for cross-origin support:

- **Tools**: navigate, get_page_text, extract_links, extract_forms, get_page_structure, click_link, fill_form, submit_form, done
- **Loop**: up to 8 iterations, processing tool calls **sequentially** (one at a time)
- **Why sequential**: each browser action (navigate → extract → click → fill) depends on the state of the previous action. Parallel execution would break the agent's ability to navigate a page, extract content, then click a link.
- The iframe is for **visual display only** — the AI "sees" pages via fetch-based text extraction (`parsePageHtml()`)

### `agent-loop.js` — Autonomous coding agent
Multi-step agent loop for folder/file coding tasks:

- **Tools**: list_dir, read_file, write_file, apply_patch, search_files, plus optional web_search, generate_image, fetch_url, read_kb
- **Loop**: up to 8 iterations, calling the model and executing tools
- Used when a folder is linked and the user asks the AI to work on files

### `voice.js` — Voice I/O
- **Speech-to-text**: Web Speech API (browser-native, free) with Whisper API fallback
- **Text-to-speech**: Web Speech API (browser-native), OpenAI TTS, or ElevenLabs TTS
- The mic button in the composer toggles recording on/off (click to start, click to stop)

### `tools.js` — External tool wrappers
- Image generation: DALL-E, Stability AI
- Web search: Tavily, Brave Search, SerpApi
- URL fetch: generic page content fetcher

### `rag.js` — Knowledge base RAG
- Chunks uploaded documents (PDF, DOCX, TXT, MD, CSV, HTML)
- Calls embedding APIs (OpenAI, Ollama, Gemini) to create vector embeddings
- Stores vectors in IndexedDB
- Retrieves via cosine similarity

### `memory.js` — Agent memory layer
- Stores short factual notes scoped to global/conversation/agent
- Retrieval via keyword matching with recency and scope scoring

### `fs-tools.js` — File System Access API
- Connects a folder or single file via the browser File System Access API
- Persists the handle in IndexedDB
- Provides read/write/search/patch operations
- Requires Chrome/Edge on desktop over https or localhost

### `doc-parser.js` — Document extraction
- PDF extraction via CDN-loaded `pdfjs-dist`
- DOCX extraction via CDN-loaded `mammoth.js`
- Text chunking for RAG

### `tool-parser.js` — Tool call parser
- Handles XML tool tags (`<tool name="..."><param>value</param></tool>`)
- Supports CDATA, markdown fences, and JSON fallback

### `db.js` — IndexedDB schema
- Version 4 schema with 4 object stores:
  - `conversations` — chat history
  - `fs-handles` — linked folder/file handles
  - `knowledge-base` — RAG document metadata and vectors
  - `agent-memory` — agent memory notes

### `sw.js` — Service worker
- Precaches app shell on install
- Stale-while-revalidate for other assets
- Never intercepts POST requests (AI API calls pass through)

---

## Data Flow

### Standard chat flow

```
User types message → Enter key
  → sendMessage() called
    → detect task type (chat, image, search, KB, folder, browser)
    → runChatFlow() for standard chat
      → selectConnection() picks best connection
      → callModel() streams response
        → onToken() updates streaming element in real-time
      → save message + response to IndexedDB
      → renderChatList() updates sidebar
```

### Browser agent flow

```
User types message in browser mode → Enter key
  → sendMessage() → runBrowserFlow()
    → build browserState with iframe navigation callback
    → runBrowserAgentLoop()
      → call model with browser system prompt
      → parse XML tool calls from response
      → execute tools sequentially (navigate → extract → click → ...)
      → feed results back to model
      → repeat until <tool name="done"> or 8 iterations
    → return final answer with page text/URL/title
```

### Voice flow

```
User clicks mic button → toggleVoiceRecording()
  → startVoiceRecording()
    → Web Speech API: createSpeechRecognizer() → start()
    → OR MediaRecorder + Whisper API
  → setVoiceRecordingUI(true) — shows recording bar, mic turns red
  → User clicks mic again or X button → stopVoiceInput()
    → transcript inserted into textarea
    → auto-send if text is non-empty
```

---

## CSS Architecture

### Dark/light mode
Uses CSS custom properties with `prefers-color-scheme` media query:

```css
:root { /* dark palette */ }
@media (prefers-color-scheme: light) { :root { /* light palette */ } }
```

### Apple system palette
- Background: `--bg`, `--bg-elev`, `--bg-elev-2`
- Text: `--text`, `--text-secondary`, `--text-tertiary`
- Accent: `--accent` (#0a84ff blue)
- Semantic: `--danger` (red), `--ok` (green), `--warn` (orange)

### Responsive breakpoints
- **≤720px**: sidebar slides in/out with `transform: translateX()`, browser panel stacks vertically
- **>720px**: sidebar is fixed 300px, browser panel is side-by-side with messages

### Composer layout
The input row uses flexbox with `gap: 8px`. All buttons are 40×40px with
`border-radius: var(--radius)` (22px). The textarea auto-grows up to 160px.

---

## Build & Deploy

### No build step
This is a pure static site. No bundler, no transpiler, no build script. Edit
files and reload the browser to see changes.

### Deployment
1. Push to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3)
2. Ensure all files are served from the same directory
3. The included GitHub Actions workflow (`.github/workflows/deploy.yml`) handles
   GitHub Pages deployment automatically

### Local development
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

> `file://` URLs will NOT work because service workers require an http(s) origin.

---

## Key Design Decisions Explained

### Why sequential browser tool execution?
The browser agent processes tool calls one at a time in a `for` loop. This is
intentional: each browser action (navigate to a page, extract its content, click
a link, fill a form) depends on the state produced by the previous action.
Parallel execution would mean trying to click a link before the page has loaded,
or filling a form that hasn't been discovered yet. The bottleneck is the AI API
call, not the tool execution, so sequential processing adds negligible latency.

### Why no backend?
A backend would require server infrastructure, authentication, and ongoing
maintenance. By running entirely in the browser, ChatAI can be deployed to any
static host with zero operational overhead. API keys stay in the user's browser
and are never sent to any server except the API endpoint the user chooses.

### Why IndexedDB over localStorage for conversations?
localStorage has a ~5MB limit and only stores strings. IndexedDB can handle
much larger datasets (hundreds of MB), supports structured objects, and
provides indexed queries. Conversations with many messages and large responses
can easily exceed localStorage limits.

### Why fetch-based page extraction for the browser agent?
The iframe is sandboxed and cannot access the DOM of cross-origin pages due to
same-origin policy. By using `fetch()` + `DOMParser` to extract page content
server-side-style, the browser agent can read any publicly accessible web page
regardless of origin. The iframe is kept for visual display only.
