# ChatAI — Offline PWA

A minimal, trustworthy, **offline-first** AI chatbox PWA you can self-host on
GitHub Pages (or any static host). Add your own **API connections** and
**agents/prompts**. Switch connections and agents from the composer, or let the
app pick them automatically based on your first message.

- Works offline: the app shell, your conversations, and your settings all load
  with no network. (AI API calls themselves need network, of course.)
- Local-only: every chat, setting, and API key lives in your browser
  (IndexedDB + localStorage). Nothing is sent to any server except the API
  endpoint you choose for a given request.
- Single-file import/export: download all conversations + settings as one JSON
  file, and import it back on any device.
- Connection-based: add as many API endpoints as you want, enable or disable
  each one, and switch quickly from the composer.
- Agent-based prompts: create multiple system prompts and pick one per chat, or
  let the app auto-select based on the first message.
- Installable: add to home screen / desktop as a PWA.
- Open source: clone and self-host as your own SaaS in minutes.

## Live demo

After deploying, your app is at:
`https://<your-username>.github.io/<your-repo>/`

## Deploy to GitHub Pages

1. Create a new public repository and push this code to it (or fork this repo).
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and
   choose **GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`)
   builds and deploys the site to GitHub Pages automatically.
4. Open the Pages URL shown under **Settings → Pages**.

> No build step required — this is a pure static site. The workflow simply
> uploads the repo root as the Pages artifact.

## Run locally

```bash
# Python 3
python3 -m http.server 8000
# then open http://localhost:8000
```

Or any static file server (`npx serve`, `caddy file-server`, etc.). A normal
`file://` URL will NOT work because service workers require an http(s) origin.

## Self-host (any static host)

Copy all files to any static host root (Netlify, Vercel, Cloudflare Pages,
S3, Nginx). Ensure `index.html`, `sw.js`, `manifest.webmanifest`, `app.js`,
`providers.js`, `styles.css`, and the `icons/` folder are all served from the
same directory. That's it — no backend, no database.

## Usage

1. Open **Settings** (gear icon in the topbar).
2. Tap **+ Add connection** and choose an API type:
   - **Ollama API** — web-accessible Ollama endpoint (tunnel, proxy, or remote host), no key required unless your setup requires one.
   - **OpenAI, Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock (proxy),
     Google Cloud Vertex AI (proxy), Moonshot Kimi, Zhipu GLM, MiniMax, NVIDIA,
     Alibaba Qwen, OpenRouter, Groq, Together AI, Fireworks AI, Cohere,
     Mistral AI, DeepSeek, Perplexity, xAI Grok, AI21 Labs, Anyscale,
     Replicate, Hugging Face, Cloudflare Workers AI** — paste your API key.
   - **Voice providers** — OpenAI Whisper (speech-to-text), OpenAI TTS, ElevenLabs TTS.
   - **Image providers** — OpenAI DALL·E, Stability AI.
   - **Search providers** — Tavily, Brave Search, SerpApi.
   - **Embedding providers** — OpenAI Embeddings, Ollama Embeddings, Gemini Embeddings (for RAG).
   - **Custom API endpoint** — any OpenAI-compatible host or proxy.
3. Tap **+ Add agent** to create custom system prompts. Default agents include
   General assistant, Data assistant, Code assistant, Writing assistant,
   Research assistant, Reason assistant, **Image creator**, **Web researcher**, and
   **Knowledge base researcher**. Image creator mode activates automatically when
   your message asks for an image.
4. In the composer, pick a connection and agent from the dropdowns, or choose
   **Auto**. Auto mode selects a suitable connection and agent from the first
   message keywords.
5. Start chatting. Press **Enter** to send, **Shift+Enter** for a newline.
   While generating, a **stop** button appears to abort the request.
   Use the **mic button** (next to the send button) for voice input — click to start recording, click again to stop.
6. Use **export** (topbar) to save everything as one JSON file, and **import**
   to restore. The HTML export button next to it downloads the current chat as an
   `.html` file with correctly rendered tables, bullet lists, headings, and token
   usage.
7. Double-click a chat title in the sidebar to rename it.
8. The **clear all data** action lives in Settings → Danger zone.
9. Install as an app (browser → Install / Add to Home Screen).

## New capabilities

### Voice input/output
- **Mic button** in the composer (next to the send button): click to start
  recording, click again to stop. Uses the free browser Web Speech API by default
  (Chrome/Edge). Optional Whisper API.
- **Speaker button** appears on assistant messages when text-to-speech is enabled
  in Settings. Uses free browser speech by default; optional OpenAI TTS or
  ElevenLabs.

### Image generation
- Ask for an image (e.g. “draw a cat” or “generate an image of a cat”) and the
  app automatically routes to an enabled **DALL·E** or **Stability AI** connection.
  The generated image is shown inline in the chat.

### Web search
- Select the **Web researcher** agent (or ask a search-style question) and the
  app calls **Tavily**, **Brave Search**, or **SerpApi**, then asks your chat
  model to answer with source citations. Source chips are rendered below the
  reply.

### RAG knowledge base
- In Settings → Knowledge base, choose an **embedding provider** and tap **Add file**
  to upload PDF, DOCX, TXT, MD, CSV, or HTML documents.
- The app chunks, embeds, and stores vectors locally in IndexedDB.
- Ask the **Knowledge base researcher** agent (or mention "my documents") to
  retrieve relevant excerpts and answer from your uploaded files.

### Document parsing
- Attach PDF or DOCX files to any chat. Text is extracted in the browser using
  `pdfjs-dist` and `mammoth.js` and included in the message context.

### Browser agent
- Click the **globe icon** in the composer to open the browser panel in split view.
- The browser panel shows a **search interface** when first opened — type a URL
  or a search query to navigate.
- Send a message in browser mode and the AI uses a fetch-based browser agent to
  navigate pages, extract content, click links, and fill forms.
- The browser agent processes tool calls **sequentially** (one at a time), which is
  the correct design for browser control since each action depends on the previous
  page state.

### Documentation & contact
- **README** and **Tech docs** buttons in the topbar open the documentation in a
  new tab.
- **Contact** button (envelope icon) opens your default mail client addressed to
  hello@pyaek.com.

### Agentic tools (folder/file coding)
- Link a folder or file in the composer. The autonomous agent loop can now also
  call **web search**, **image generation**, **URL fetch**, and **knowledge base
  search** when those connections are enabled, in addition to reading/writing
  files.

### Where to get API keys

- **OpenAI:** https://platform.openai.com/api-keys
- **Anthropic Claude:** https://console.anthropic.com/settings/keys
- **Google Gemini / AI Studio:** https://aistudio.google.com/app/apikey
- **Azure OpenAI:** https://portal.azure.com/
- **Moonshot Kimi:** https://platform.moonshot.cn/console/api-keys
- **Zhipu GLM:** https://open.bigmodel.cn/usercenter/apikeys
- **MiniMax:** https://platform.minimaxi.com/user-center/basic-information/interface-key
- **NVIDIA:** https://build.nvidia.com/
- **Alibaba Qwen (DashScope):** https://dashscope.console.aliyun.com/apiKey
- **OpenRouter:** https://openrouter.ai/keys
- **Groq:** https://console.groq.com/keys
- **Together AI:** https://api.together.xyz/settings/api-keys
- **Fireworks AI:** https://fireworks.ai/account/api-keys
- **Cohere:** https://dashboard.cohere.com/api-keys
- **Mistral AI:** https://console.mistral.ai/api-keys/
- **DeepSeek:** https://platform.deepseek.com/api_keys
- **Perplexity:** https://www.perplexity.ai/settings/api
- **xAI Grok:** https://console.x.ai/
- **AI21 Labs:** https://studio.ai21.com/account/api-key
- **Anyscale:** https://app.endpoints.anyscale.com/credentials
- **Replicate:** https://replicate.com/account/api-tokens
- **Hugging Face:** https://huggingface.co/settings/tokens
- **Cloudflare:** https://dash.cloudflare.com/profile/api-tokens
- **Whisper / OpenAI TTS / DALL·E:** https://platform.openai.com/api-keys
- **ElevenLabs TTS:** https://elevenlabs.io/app/settings/api-keys
- **Stability AI:** https://platform.stability.ai/account/keys
- **Tavily Search:** https://app.tavily.com/home
- **Brave Search API:** https://api.search.brave.com/app/keys
- **SerpApi:** https://serpapi.com/manage-api-key
- **Local (Ollama):** no key — https://ollama.com

## Privacy

- API keys, conversations, and settings are stored locally in your browser only.
- Requests go directly from your browser to the endpoint you select.
- There is no server, no analytics, no accounts, no tracking.
- Clearing your browser data deletes everything. Use **export** to back up.

## Agentic folder/file coding (Claude Code–style)

10. Click the **folder icon** next to the attachment button in the composer to link a location:
    - **Link a folder** — the agent can list, read, write, search, and patch any file inside it.
    - **Link a file** — the agent can read and write a single file directly.
    - File access uses the browser File System Access API, so it requires **Chrome or Edge on desktop** over https or localhost. Other browsers show a banner and can still use file attachments.
    - The linked location is remembered in IndexedDB. After a browser restart you may be asked to re-confirm permission.
11. Once a folder or file is linked, every agent automatically becomes folder-aware for that chat and can read/write the linked location. The agent is explicitly told it is authorized, so it should use tools instead of refusing.
12. Ask the agent to do something with the project, e.g.:
    - "Create an `about.html` page."
    - "Refactor `app.js` to use async/await everywhere."
    - "Find where API keys are handled and summarize it."
14. The agent runs an autonomous loop (read → plan → write → verify) until it emits a final answer. A live stop button lets you interrupt it.
15. File edits are applied automatically by default. Tool steps are shown as collapsible blocks in the chat so you can inspect what changed.
16. Click any file in the sidebar file tree to preview it.
17. Tap the linked-location chip in the composer or the disconnect icon in the sidebar to unlink.

## Project structure

```
index.html            App shell
app.js                Chat UI, IndexedDB history, streaming, import/export, settings, folder wiring, routing
providers.js          API connection presets and default agents
model-router.js       Connection selection, API routing, streaming SSE parsing, fallback logic
browser-agent.js      AI-driven browser control agent (fetch-based page extraction)
agent-loop.js         Autonomous multi-step coding/writing/research loop with extra tools
voice.js              Web Speech API + Whisper/TTS helpers
tools.js              Image generation and web search API wrappers
doc-parser.js         PDF/DOCX/text extraction and text chunking
rag.js                Knowledge-base chunking, embedding, vector storage, retrieval
memory.js             Lightweight agent memory layer (scoped notes)
tool-parser.js        Shared XML/JSON tool call parser
fs-tools.js           File System Access API wrapper (list, read, write, patch, search)
db.js                 IndexedDB wrapper (conversations, folder handles, knowledge base)
styles.css            Minimal responsive dark/light UI
sw.js                 Service worker (app-shell precache + stale-while-revalidate)
manifest.webmanifest  PWA manifest (installable)
icons/                App icons (SVG + PNG)
.github/workflows/deploy.yml   GitHub Pages deploy workflow
```

## License

MIT — do whatever you want. Attribution appreciated.
