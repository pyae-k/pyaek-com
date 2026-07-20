// "Output" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (export_file) into a typed StepDef.
// export_file is engine-handled (writes a downloadable file), so it is marked
// `scriptOnly` and buildSql emits a marker comment rather than WASM-runnable SQL.

import type { StepDef } from "./types";

interface ExportFileConfig {
  format?: string;
  fileName?: string;
  fileNameBase?: string;
  dateTimePosition?: string;
  connectionId?: string;
  // Format-specific options
  delimiter?: string;
  compression?: string;
  includeHeader?: boolean;
  encoding?: string;
}

export const outputSteps: StepDef[] = [
  {
    kind: "export_file",
    category: "output",
    name: "Export to file",
    description: "Export to CSV, Parquet, or Excel",
    scriptOnly: true,
    defaultConfig: {
      format: "csv",
      fileName: "",
      fileNameBase: "export",
      dateTimePosition: "end",
      connectionId: "",
      delimiter: ",",
      compression: "none",
      includeHeader: true,
      encoding: "utf-8",
    },
    buildSql(config) {
      const cfg = config as ExportFileConfig;
      const format = String(cfg.format ?? "");
      // Engine-handled (writes a downloadable file); emit a marker.
      return `-- export_file: ${format}`;
    },
  },
];