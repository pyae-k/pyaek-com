# Pyae Phyo Kyaw | Open-Source AI & Data Tools Portfolio

A collection of privacy-focused, local-first, and open-source web applications. These tools are designed to work offline, require no accounts, and ensure that your data stays on your device.

## 🚀 Projects

### 🤖 [AI Workspace](/ai)
A trustworthy, offline-first AI chatbox PWA.
- **Local-Only:** Conversations and API keys are stored in your browser's IndexedDB.
- **Customizable:** Add your own API connections (OpenAI, Anthropic, Ollama, etc.) and custom agent prompts.
- **Advanced Features:** Supports RAG (Knowledge Base), Voice Input/Output, Image Generation, and Agentic Folder/File coding.

### 📊 [Data Preparation](/data)
A browser-based ETL studio for private data cleaning and transformation.
- **Private:** All processing happens locally in your browser using DuckDB WASM.
- **Secure:** Your sensitive datasets never leave your device.
- **Efficient:** Clean, filter, and transform data with SQL and a modern UI.

### 👤 [About Me](/about)
A personal portfolio page detailing my professional experience as a Data Analyst specializing in Healthcare Analytics and Business Intelligence.

---

## 🛠️ Getting Started

### Run Locally
Since these are PWAs and use Service Workers, they require an HTTP origin to function correctly. You cannot open the files directly via `file://`.

```bash
# Using Python
python3 -m http.server 8000
# Then open http://localhost:8000 in your browser
```

### Deploy to GitHub Pages
1. Push this repository to GitHub.
2. Go to **Settings $\rightarrow$ Pages**.
3. Select **GitHub Actions** as the build source.
4. The projects will be automatically deployed to your GitHub Pages URL.

---

## 📜 Documentation
- [Technical Documentation](./TECHNICAL.md) — Deep dive into the architecture, PWA implementation, and project modules.
- [Design System](./design-system.css) — The master design language used across the portfolio.

## 📦 Distribution (Zip Project)

To package this entire portfolio into a single zip file for sharing or backup, use the provided packaging script.

### Create Project Zip
Run the following command in the root directory:

```bash
chmod +x package.sh
./package.sh
```

This will create a file named `pyaek-portfolio.zip` containing only the necessary project files (excluding `.git`, `.claude`, and other system files).

## 📜 License
MIT — Free to use, modify, and distribute.
