import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const destDir = join(root, "public", "duckdb");

if (!existsSync(srcDir)) {
  console.error("DuckDB-WASM not found in node_modules. Run npm install first.");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

const files = [
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
];

for (const file of files) {
  const src = join(srcDir, file);
  const dest = join(destDir, file);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  } else {
    console.error(`Missing: ${file}`);
    process.exit(1);
  }
}

console.log("DuckDB assets copied to public/duckdb/");