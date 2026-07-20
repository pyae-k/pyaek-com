// doc-parser.js — extract text from PDF, DOCX, and common text formats in the browser.
// Uses CDN copies of pdfjs-dist and mammoth.js. Falls back gracefully when offline.

const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs";
const PDFJS_WORKER_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
const MAMMOTH_CDN = "https://cdn.jsdelivr.net/npm/mammoth@1.7.2/mammoth.browser.min.js";

let pdfjsPromise = null;
let mammothPromise = null;

async function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    if (typeof window === "undefined") throw new Error("PDF parsing requires a browser window");
    const mod = await import(PDFJS_CDN);
    const pdfjs = mod.default || mod;
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    return pdfjs;
  })();
  return pdfjsPromise;
}

async function loadMammoth() {
  if (mammothPromise) return mammothPromise;
  mammothPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("DOCX parsing requires a browser window"));
    if (window.mammoth) return resolve(window.mammoth);
    const script = document.createElement("script");
    script.src = MAMMOTH_CDN;
    script.async = true;
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error("Failed to load mammoth.js"));
    document.head.appendChild(script);
  });
  return mammothPromise;
}

export function getDocumentExtension(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export async function extractTextFromFile(file) {
  const ext = getDocumentExtension(file.name);
  if (ext === "pdf") return extractFromPdf(file);
  if (ext === "docx" || ext === "doc") return extractFromDocx(file);
  if (["txt", "md", "csv", "html", "htm", "json", "js", "css", "py", "sql", "xml"].includes(ext)) {
    return file.text();
  }
  throw new Error(`Unsupported document type: ${ext || file.type}`);
}

async function extractFromPdf(file) {
  try {
    const pdfjs = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      texts.push(pageText);
    }
    return texts.join("\n\n");
  } catch (e) {
    console.error("PDF extraction failed", e);
    throw new Error(`Could not read PDF: ${e.message || e}`);
  }
}

async function extractFromDocx(file) {
  try {
    const mammoth = await loadMammoth();
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  } catch (e) {
    console.error("DOCX extraction failed", e);
    throw new Error(`Could not read DOCX: ${e.message || e}`);
  }
}

// Simple chunking used by both attachments and RAG.
export function chunkText(text, { chunkSize = 500, overlap = 100 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize);
    chunks.push(slice.join(" "));
    i += Math.max(1, chunkSize - overlap);
    if (slice.length < chunkSize) break;
  }
  return chunks;
}
