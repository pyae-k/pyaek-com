// Shared form primitives used by every step-config dialog. Kept minimal and
// unstyled-ish (inherits app CSS classes) so the per-step dialogs read like one
// another and stay easy to port from pwa_duckdb/js/step-dialogs.js.

import { useState, useRef, useEffect, type ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="step-field">
      <span className="step-field-label">{label}</span>
      {children}
      {hint && <span className="step-field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className="step-input"
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  placeholder,
}: {
  value: number | string;
  onChange: (v: number) => void;
  min?: number;
  placeholder?: string;
}) {
  return (
    <input
      className="step-input"
      type="number"
      value={value}
      min={min}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      className="step-input"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="step-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Multi-select list of column names with toggle checkboxes and select-all. */
export function ColumnMultiSelect({
  columns,
  selected,
  onChange,
}: {
  columns: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (col: string) => {
    onChange(selected.includes(col) ? selected.filter((c) => c !== col) : [...selected, col]);
  };
  const allSelected = columns.length > 0 && selected.length === columns.length;
  const someSelected = selected.length > 0 && selected.length < columns.length;
  const setAll = (checked: boolean) => onChange(checked ? [...columns] : []);

  if (!columns.length) {
    return <div className="step-field-hint">No columns available from the previous step.</div>;
  }
  return (
    <div className="column-multiselect">
      <div className="column-multiselect-toolbar">
        <label className="step-checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => setAll(e.target.checked)}
          />
          <span>{allSelected ? "Unselect all" : "Select all"}</span>
        </label>
      </div>
      {columns.map((col) => (
        <label key={col} className="step-checkbox">
          <input
            type="checkbox"
            checked={selected.includes(col)}
            onChange={() => toggle(col)}
          />
          <span>{col}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Searchable multi-select of columns with type badges.
 * Columns are grouped by type and can be filtered by search text.
 */
export function SearchableColumnMultiSelect({
  columns,
  selected,
  onChange,
  columnTypes,
}: {
  columns: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  columnTypes?: Record<string, string>;
}) {
  const [query, setQuery] = useState("");

  const filtered = query
    ? columns.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
    : columns;

  const toggle = (col: string) => {
    onChange(selected.includes(col) ? selected.filter((c) => c !== col) : [...selected, col]);
  };

  const typeColor = (type: string): string => {
    const t = (type || "").toLowerCase();
    if (t.includes("int") || t === "bigint" || t === "integer") return "var(--accent)";
    if (t.includes("double") || t.includes("float") || t.includes("dec") || t === "number") return "var(--success)";
    if (t.includes("date") || t.includes("time")) return "var(--warning)";
    if (t.includes("bool")) return "var(--error)";
    return "var(--text-muted)";
  };

  if (!columns.length) {
    return <div className="step-field-hint">No columns available.</div>;
  }

  return (
    <div>
      <input
        className="step-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search columns..."
        style={{ marginBottom: 6, fontSize: 12 }}
      />
      <div className="column-multiselect" style={{ maxHeight: 200, overflowY: "auto" }}>
        {filtered.map((col) => {
          const type = columnTypes?.[col] || "";
          return (
            <label key={col} className="step-checkbox" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={selected.includes(col)}
                onChange={() => toggle(col)}
              />
              <span style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>{col}</span>
              {type && (
                <span style={{
                  fontSize: 9,
                  padding: "1px 4px",
                  borderRadius: 3,
                  background: typeColor(type),
                  color: "white",
                  fontWeight: 600,
                }}>
                  {type}
                </span>
              )}
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 0" }}>No matches</div>
        )}
      </div>
    </div>
  );
}

/** Single-select dropdown of column names. */
export function ColumnSelect({
  columns,
  value,
  onChange,
  placeholder = "(select column)",
}: {
  columns: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: placeholder },
        ...columns.map((c) => ({ value: c, label: c })),
      ]}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="step-input"
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Searchable select: text input that filters a dropdown of options.
 * Useful for large lists (e.g., distinct pivot values).
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search...",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        className="step-input"
        type="text"
        value={open ? query : selected?.label || value || ""}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          maxHeight: 200,
          overflowY: "auto",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          zIndex: 100,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}>
          {filtered.map((o) => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--font-mono, monospace)",
                background: o.value === value ? "var(--accent)" : "transparent",
                color: o.value === value ? "white" : "var(--text-primary)",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = o.value === value ? "var(--accent)" : "transparent"; }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          padding: "6px 10px",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          zIndex: 100,
          fontSize: 12,
          color: "var(--text-muted)",
        }}>
          No matches
        </div>
      )}
    </div>
  );
}

/** Small helper to read a typed field from a config record with a fallback. */
export function cfg<T>(config: Record<string, unknown>, key: string, fallback: T): T {
  const v = config[key];
  return (v === undefined || v === null ? fallback : v) as T;
}