// Config dialog for the custom_sql step. Multi-tab layout:
//   "Write SQL" tab: searchable column panel + CodeMirror editor + template gallery
//   "AI Generate" tab: column context + prompt + diff view
// Supports local language prompts, column-aware AI generation, and inline validation.

import { useState, useCallback, useRef, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { aiGenerate, getAiSettings } from "../../lib/ai";
import { explainSql } from "../../engine/executor";
import type { StepDialogProps } from "../../steps/types";
import { SearchableColumnMultiSelect } from "./controls";

// SQL template patterns
const SQL_TEMPLATES = [
  {
    category: "Filtering",
    items: [
      { label: "Basic filter", sql: "SELECT * FROM prev\nWHERE \"column\" = 'value'" },
      { label: "Multiple conditions", sql: "SELECT * FROM prev\nWHERE \"col1\" > 100\n  AND \"col2\" IS NOT NULL" },
      { label: "IN list", sql: "SELECT * FROM prev\nWHERE \"column\" IN ('a', 'b', 'c')" },
    ],
  },
  {
    category: "Aggregation",
    items: [
      { label: "Group by + SUM", sql: "SELECT \"group_col\", SUM(\"value_col\") AS total\nFROM prev\nGROUP BY \"group_col\"" },
      { label: "Group by + COUNT", sql: "SELECT \"group_col\", COUNT(*) AS cnt, AVG(\"value_col\") AS avg_val\nFROM prev\nGROUP BY \"group_col\"" },
      { label: "HAVING filter", sql: "SELECT \"group_col\", SUM(\"value_col\") AS total\nFROM prev\nGROUP BY \"group_col\"\nHAVING SUM(\"value_col\") > 100" },
    ],
  },
  {
    category: "Window Functions",
    items: [
      { label: "ROW_NUMBER", sql: "SELECT *, ROW_NUMBER() OVER (PARTITION BY \"group_col\" ORDER BY \"order_col\") AS rn\nFROM prev" },
      { label: "Running total", sql: "SELECT *, SUM(\"value_col\") OVER (ORDER BY \"order_col\") AS running_total\nFROM prev" },
      { label: "LAG / LEAD", sql: "SELECT *, LAG(\"value_col\") OVER (ORDER BY \"order_col\") AS prev_value\nFROM prev" },
    ],
  },
  {
    category: "Date Operations",
    items: [
      { label: "DATE_TRUNC", sql: "SELECT *, DATE_TRUNC('month', \"date_col\") AS month\nFROM prev" },
      { label: "Date difference", sql: "SELECT *, DATE_DIFF('day', \"start_date\", \"end_date\") AS days_diff\nFROM prev" },
      { label: "EXTRACT", sql: "SELECT *, EXTRACT(YEAR FROM \"date_col\") AS year\nFROM prev" },
    ],
  },
  {
    category: "CTE Pipeline",
    items: [
      { label: "Multi-step CTE", sql: "WITH step1 AS (\n  SELECT * FROM prev\n  WHERE \"column\" IS NOT NULL\n),\nstep2 AS (\n  SELECT \"group_col\", COUNT(*) AS cnt\n  FROM step1\n  GROUP BY \"group_col\"\n)\nSELECT * FROM step2" },
      { label: "CTE with join", sql: "WITH filtered AS (\n  SELECT * FROM prev\n  WHERE \"column\" > 0\n)\nSELECT f.*, other.\"col\"\nFROM filtered f\nLEFT JOIN other_query AS other ON f.\"key\" = other.\"key\"" },
    ],
  },
];

export function CustomSqlDialog({ config, onChange, onClose, prevColumns }: StepDialogProps) {
  const [sql, setSql] = useState(String(config.sql ?? "SELECT * FROM prev"));
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCols, setSelectedCols] = useState<string[]>(prevColumns ?? []);
  const [activeTab, setActiveTab] = useState<"write" | "ai">("write");
  const [showTemplates, setShowTemplates] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const settings = getAiSettings();
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline SQL validation with debounce
  useEffect(() => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (!sql.trim() || sql === "SELECT * FROM prev") {
      setValidationMsg(null);
      return;
    }
    validateTimerRef.current = setTimeout(async () => {
      try {
        await explainSql(sql);
        setValidationMsg(null);
      } catch (e) {
        setValidationMsg(e instanceof Error ? e.message : String(e));
      }
    }, 800);
    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    };
  }, [sql]);

  const apply = () => {
    onChange({ sql });
    onClose();
  };

  const insertColumn = useCallback((col: string) => {
    const quoted = `"${col}"`;
    setSql((prev) => {
      const trimmed = prev.trimEnd();
      const sep = trimmed && !trimmed.endsWith(" ") ? " " : "";
      return trimmed + sep + quoted;
    });
  }, []);

  const insertTemplate = (templateSql: string) => {
    setSql(templateSql);
    setShowTemplates(false);
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setAiResult(null);
    setShowDiff(false);
    try {
      const out = await aiGenerate({
        kind: "sql",
        prompt,
        columns: selectedCols,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });
      setAiResult(out);
      setShowDiff(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyAiResult = () => {
    if (aiResult) {
      setSql(aiResult);
      setAiResult(null);
      setShowDiff(false);
      setActiveTab("write");
    }
  };

  const discardAiResult = () => {
    setAiResult(null);
    setShowDiff(false);
  };

  const allColumns = prevColumns ?? [];

  // Simple line-by-line diff
  const renderDiff = (): Array<{ type: "same" | "removed" | "added"; text: string }> => {
    if (!aiResult) return [];
    const currentLines = sql.split("\n");
    const newLines = aiResult.split("\n");
    const maxLines = Math.max(currentLines.length, newLines.length);
    const lines: Array<{ type: "same" | "removed" | "added"; text: string }> = [];

    for (let i = 0; i < maxLines; i++) {
      const oldLine = currentLines[i] ?? "";
      const newLine = newLines[i] ?? "";
      if (oldLine === newLine) {
        lines.push({ type: "same", text: oldLine });
      } else {
        if (oldLine) lines.push({ type: "removed", text: oldLine });
        if (newLine) lines.push({ type: "added", text: newLine });
      }
    }
    return lines;
  };

  const diffLines = showDiff && aiResult ? renderDiff() : [];

  return (
    <div className="step-dialog-body" style={{ padding: 0, gap: 0, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => setActiveTab("write")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            background: activeTab === "write" ? "var(--bg-secondary)" : "transparent",
            color: activeTab === "write" ? "var(--text-primary)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            borderBottom: activeTab === "write" ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          ✏️ Write SQL
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            background: activeTab === "ai" ? "var(--bg-secondary)" : "transparent",
            color: activeTab === "ai" ? "var(--text-primary)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            borderBottom: activeTab === "ai" ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          🤖 AI Generate
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "write" && (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left: Searchable column panel */}
          {allColumns.length > 0 && (
            <div style={{
              width: 200,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: 8,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.05em" }}>
                Columns
              </div>
              <SearchableColumnMultiSelect
                columns={allColumns}
                selected={selectedCols}
                onChange={setSelectedCols}
              />
              <div style={{ marginTop: 6 }}>
                {selectedCols.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => insertColumn(col)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "3px 6px",
                      fontSize: 11,
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono, monospace)",
                      marginBottom: 2,
                    }}
                    title={`Click to insert "${col}"`}
                  >
                    + {col}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Center: SQL editor + validation */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <CodeMirror
                value={sql}
                height="100%"
                theme="dark"
                extensions={[sqlLang()]}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
                onChange={(val) => setSql(val)}
              />
            </div>

            {/* Validation message */}
            {validationMsg && (
              <div style={{
                padding: "6px 10px",
                background: "rgba(239,68,68,0.1)",
                borderTop: "1px solid var(--error)",
                fontSize: 11,
                color: "var(--error)",
                fontFamily: "var(--font-mono, monospace)",
                maxHeight: 80,
                overflowY: "auto",
                flexShrink: 0,
              }}>
                ⚠ {validationMsg}
              </div>
            )}

            {/* Template gallery */}
            <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)" }}>
              <button
                onClick={() => setShowTemplates((v) => !v)}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  border: "none",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {showTemplates ? "▾" : "▸"} SQL Templates
              </button>
              {showTemplates && (
                <div style={{
                  maxHeight: 160,
                  overflowY: "auto",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                  {SQL_TEMPLATES.map((group) => (
                    <div key={group.category}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 2, padding: "0 4px" }}>
                        {group.category}
                      </div>
                      {group.items.map((item) => (
                        <button
                          key={item.label}
                          onClick={() => insertTemplate(item.sql)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "4px 8px",
                            fontSize: 11,
                            border: "none",
                            borderRadius: 3,
                            background: "transparent",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                          title={item.sql}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "ai" && (
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "auto", padding: 12, gap: 12 }}>
          {/* Left: Column context + prompt */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
              Column Context ({selectedCols.length})
            </div>
            {allColumns.length > 0 && (
              <SearchableColumnMultiSelect
                columns={allColumns}
                selected={selectedCols}
                onChange={setSelectedCols}
              />
            )}

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", marginTop: 4 }}>
              Prompt
            </div>
            <textarea
              className="step-input"
              value={prompt}
              rows={6}
              placeholder={
                'Describe what you want in any language, e.g.:\n"Filter to rows where amount > 100 and group by region"\n\n"按地区分组并计算销售额总和"\n\n"Create a CTE that first filters, then aggregates"'
              }
              onChange={(e) => setPrompt(e.target.value)}
              style={{ fontFamily: "var(--font-sans)", fontSize: 12, resize: "vertical", minHeight: 80 }}
            />

            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {settings.provider === "ollama"
                ? `Model: ${settings.model || "not configured"}`
                : `Provider: ${settings.provider} · Model: ${settings.model || settings.claudeModel || settings.openaiModel || settings.geminiModel || settings.groqModel || settings.openrouterModel || "not configured"}`
              }
            </div>

            <button
              onClick={generate}
              disabled={busy || !prompt.trim()}
              className="primary"
              style={{ width: "100%" }}
            >
              {busy ? "Generating…" : "Generate SQL"}
            </button>

            {error && <div className="step-error" style={{ fontSize: 11 }}>{error}</div>}
          </div>

          {/* Right: Diff view */}
          {showDiff && aiResult && (
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0,
              borderLeft: "1px solid var(--border)",
              paddingLeft: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                Generated SQL — Review Changes
              </div>
              <div style={{
                flex: 1,
                overflow: "auto",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
                lineHeight: 1.5,
              }}>
                {diffLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "2px 8px",
                      background: line.type === "removed" ? "rgba(239,68,68,0.15)" : line.type === "added" ? "rgba(34,197,94,0.15)" : "transparent",
                      color: line.type === "removed" ? "var(--error)" : line.type === "added" ? "var(--success)" : "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {line.type === "removed" ? "− " : line.type === "added" ? "+ " : "  "}
                    {line.text}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={discardAiResult} style={{ flex: 1 }}>Discard</button>
                <button onClick={applyAiResult} className="primary" style={{ flex: 1 }}>Apply</button>
              </div>
            </div>
          )}

          {/* No diff yet — show placeholder */}
          {!showDiff && (
            <div style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderLeft: "1px solid var(--border)",
              paddingLeft: 12,
              color: "var(--text-muted)",
              fontSize: 12,
            }}>
              {busy ? "Generating..." : "Enter a prompt and click Generate to create SQL"}
            </div>
          )}
        </div>
      )}

      {/* Bottom actions */}
      <div className="step-dialog-actions" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}
