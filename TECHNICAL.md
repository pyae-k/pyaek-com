# Technical Documentation: Pyae Phyo Kyaw Portfolio

## Architecture Overview
The portfolio is a collection of **Progressive Web Applications (PWAs)**. The project follows a "Static-First" architecture, meaning there is no backend server; all logic runs in the client's browser.

### Core Technologies
- **Frontend:** HTML5, CSS3 (using a centralized Design System), and Vanilla JavaScript (ES6+).
- **PWA Capabilities:** 
    - **Service Workers:** Implemented via `sw.js` to provide offline capabilities and fast asset caching.
    - **Web App Manifest:** `manifest.json` allows the site to be installable on iOS, Android, and Desktop.
- **Storage:** 
    - **IndexedDB:** Used for persistent, large-scale local storage (e.g., AI chat history, RAG vector store).
    - **LocalStorage:** Used for lightweight settings and preferences.

---

## Project Modules

### 1. Landing Page (`/`)
The entry point of the portfolio. It uses a semantic HTML structure optimized for SEO and accessibility.
- **SEO:** Implements Open Graph and Twitter Card metadata.
- **Styling:** Powered by `design-system.css` for a consistent Apple-inspired look.

### 2. AI Workspace (`/ai`)
A complex AI agent interface.
- **Provider System:** A modular `providers.js` handles multiple API endpoints (OpenAI, Anthropic, Ollama, etc.).
- **Agent Loop:** `agent-loop.js` implements an autonomous loop (Read $\rightarrow$ Plan $\rightarrow$ Write $\rightarrow$ Verify) for file system operations.
- **RAG System:** Uses a local vector storage implementation in `rag.js` and `db.js`.
- **File Access:** Utilizes the browser's **File System Access API** via `fs-tools.js`.

### 3. Data Preparation (`/data`)
An in-browser ETL tool.
- **Engine:** Powered by **DuckDB WASM**, allowing SQL queries to run directly on local files without uploading data to a server.
- **Privacy:** 100% client-side execution.

### 4. About Me (`/about`)
A static professional profile page.

---

## Deployment Guide
The project is designed for zero-config deployment.

### GitHub Pages Deployment
1. Push to a public repo.
2. Enable GitHub Pages in **Settings $\rightarrow$ Pages**.
3. The project is compatible with both the "Deploy from a branch" and "GitHub Actions" workflows.

### Local Testing
Run via any static server (e.g., `python3 -m http.server 3000`).
**Note:** Accessing via `file://` will disable Service Workers.

---

## Maintenance & Distribution
The project includes a `package.sh` script to bundle the source code for distribution, ensuring that environment-specific files (like `.git` or `.claude`) are excluded.
