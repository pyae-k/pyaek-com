# ETL Studio

A browser-based ETL (Extract, Transform, Load) designer powered by [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview). Build data pipelines visually with a step-based editor, preview results in real-time, and export to CSV, Parquet, Excel, JSON, or JSONL — all in your browser, no server required.

**Live demo:** [pyaek.com/data](https://pyaek.com/data)

## Features

- **Step-based pipeline editor** — Build ETL workflows by adding, configuring, and reordering steps
- **30+ transform steps** — Filter, sort, aggregate, pivot, join, change types, formula columns, and more
- **Live preview** — See results instantly as you build your pipeline
- **SQL editor** — Write custom SQL with syntax highlighting and AI assistance
- **AI-powered generation** — Describe what you want in natural language and let AI write the SQL
- **Multiple AI providers** — Ollama (local), Claude, OpenAI, Gemini, Groq, OpenRouter
- **Export** — Download results as CSV, Parquet, Excel, JSON, or JSONL
- **Connections** — Link local folders or connect to databases (PostgreSQL, MySQL, SQLite, etc.)
- **Cross-query references** — One query can reference another's output
- **PWA** — Install as a desktop app, works offline after initial load
- **Dark theme** — Easy on the eyes

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 18 + TypeScript |
| **Bundler** | Vite 6 |
| **Database** | DuckDB-WASM (in-browser) |
| **State** | Zustand 5 |
| **Persistence** | File System Access API + IndexedDB |
| **UI** | Hand-built with CSS custom properties |
| **AI** | Ollama, Claude, OpenAI, Gemini, Groq, OpenRouter |
| **PWA** | vite-plugin-pwa (Workbox) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The app runs at `http://localhost:5173` (or the next available port).

### Build

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server.

### AI Setup (Optional)

1. **Ollama (local):** Install [Ollama](https://ollama.com), pull a model (`ollama pull gemma3:4b`), start with `OLLAMA_ORIGINS=* ollama serve`
2. **Cloud providers:** Get API keys from Anthropic, OpenAI, Google AI Studio, Groq, or OpenRouter, then configure in the AI panel

## Project Structure

```
src/
  main.tsx                    # App entry point
  App.tsx                     # Root component (layout + modals)
  components/
    layout/                   # App shell (Header, LeftPanel, CenterPanel, etc.)
    steps/                    # Step config dialogs
    modals/                   # Modal overlays (AI, Connections, etc.)
    icons/                    # SVG icon components
  steps/                      # Step definitions (buildSql per kind)
  engine/                     # CTE builder, SQL executor, references
  store/                      # Zustand stores
  lib/                        # Utilities (DuckDB, AI, export, file access)
  types/                      # TypeScript type definitions
  styles/                     # CSS (theme + layout)
```

## Contact

**Email:** [hello@pyaek.com](mailto:hello@pyaek.com)

## License

MIT
