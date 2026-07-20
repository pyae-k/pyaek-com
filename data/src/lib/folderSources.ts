// Pure helpers for folder connections: manifest mapping and path utilities.
// Kept separate from datasetFiles.ts so it can be unit-tested without pulling
// in DuckDB / SheetJS.

import type { FolderFile } from "./fileAccess";
import type { FolderFileManifestEntry } from "../types/connection";
import { sanitizeVirtualName } from "./fileReaders";

/** Build a manifest entry for each supported file in a linked folder. */
export function buildFolderFileManifestEntries(files: FolderFile[]): FolderFileManifestEntry[] {
  return files.map((f) => {
    const virtualName = sanitizeVirtualName(f.relPath);
    const jsonVirtualName = f.ext === "xlsx" || f.ext === "xls" ? `${virtualName}.json` : null;
    return {
      relPath: f.relPath,
      name: f.name,
      ext: f.ext,
      virtualName,
      jsonVirtualName,
    };
  });
}

/** Pick the relative path to use when resolving a source config. */
export function sourceRelPath(cfg: {
  relPath?: string;
  sourceName?: string;
}): string | null {
  return cfg.relPath || cfg.sourceName || null;
}
