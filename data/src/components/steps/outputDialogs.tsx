// Config dialog for the "output" category. export_file writes to a folder/download.
// Engine-handled (scriptOnly).

import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, cfg } from "./controls";

const FORMATS = [
  { value: "csv", label: "CSV (.csv)" },
  { value: "parquet", label: "Parquet (.parquet)" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "json", label: "JSON (.json)" },
  { value: "jsonl", label: "JSONL (.jsonl)" },
];

const DATE_POSITIONS = [
  { value: "none", label: "No date stamp" },
  { value: "end", label: "Append date (name_20260721.ext)" },
  { value: "start", label: "Prepend date (20260721_name.ext)" },
];

const DELIMITERS = [
  { value: ",", label: "Comma (,)" },
  { value: "\t", label: "Tab" },
  { value: ";", label: "Semicolon (;)" },
  { value: "|", label: "Pipe (|)" },
];

const COMPRESSION = [
  { value: "none", label: "None" },
  { value: "gzip", label: "GZip" },
  { value: "snappy", label: "Snappy" },
  { value: "zstd", label: "Zstd" },
];

function yyyymmdd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function ExportFileDialog({ config, onChange }: StepDialogProps) {
  const format = String(cfg(config, "format", "csv"));
  const fileName = String(cfg(config, "fileName", cfg(config, "fileNameBase", "export")));
  const dateTimePosition = String(cfg(config, "dateTimePosition", "end"));
  const delimiter = String(cfg(config, "delimiter", ","));
  const compression = String(cfg(config, "compression", "none"));
  const includeHeader = Boolean(cfg(config, "includeHeader", true));

  const today = yyyymmdd();
  const ext = format === "jsonl" ? "jsonl" : format;
  const previewName = dateTimePosition === "start"
    ? `${today}_${fileName}.${ext}`
    : dateTimePosition === "end"
      ? `${fileName}_${today}.${ext}`
      : `${fileName}.${ext}`;

  return (
    <div className="step-dialog-body">
      {/* File name preview card */}
      <div style={{
        background: "linear-gradient(135deg, var(--bg-secondary), var(--bg-primary))",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Export Preview
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 13,
          color: "var(--text-primary)",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "8px 10px",
        }}>
          <span style={{ fontSize: 16 }}>📁</span>
          <span style={{ color: "var(--text-muted)" }}>Downloads</span>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <span style={{ fontWeight: 600 }}>{previewName}</span>
        </div>
      </div>

      {/* Main settings row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Format">
            <Select value={format} onChange={(v) => onChange({ ...config, format: v })} options={FORMATS} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Date stamp">
            <Select value={dateTimePosition} onChange={(v) => onChange({ ...config, dateTimePosition: v })} options={DATE_POSITIONS} />
          </Field>
        </div>
      </div>

      <Field label="File name">
        <TextInput
          value={fileName}
          onChange={(v) => onChange({ ...config, fileName: v, fileNameBase: v })}
          placeholder="my_export"
        />
      </Field>

      {/* Format-specific options */}
      {format === "csv" && (
        <div style={{
          marginTop: 12,
          padding: 10,
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
            CSV Options
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field label="Delimiter">
                <Select value={delimiter} onChange={(v) => onChange({ ...config, delimiter: v })} options={DELIMITERS} />
              </Field>
            </div>
            <div style={{ paddingBottom: 4 }}>
              <label className="step-checkbox">
                <input
                  type="checkbox"
                  checked={includeHeader}
                  onChange={(e) => onChange({ ...config, includeHeader: e.target.checked })}
                />
                <span>Header</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {format === "parquet" && (
        <div style={{
          marginTop: 12,
          padding: 10,
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
            Parquet Options
          </div>
          <Field label="Compression">
            <Select value={compression} onChange={(v) => onChange({ ...config, compression: v })} options={COMPRESSION} />
          </Field>
        </div>
      )}

      {format === "json" && (
        <div style={{
          marginTop: 12,
          padding: "8px 10px",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}>
          JSON format exports the full result as a single JSON array file.
        </div>
      )}

      {format === "jsonl" && (
        <div style={{
          marginTop: 12,
          padding: "8px 10px",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}>
          JSONL format exports one JSON object per line — ideal for streaming and large datasets.
        </div>
      )}
    </div>
  );
}