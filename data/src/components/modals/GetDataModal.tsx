// Get Data modal: pick a source from a connection and add it as a source step.
// For a linked folder connection, lists supported files (File System Access),
// reads + registers the file buffer with DuckDB, then adds a `source_file` step
// whose SQL is the file-reader query. For server connections, takes a manual
// schema/table and adds a `source_connection` step (script-only).
//
// UX: opening the modal auto-loads the file list when the chosen connection is
// already linked, so the user doesn't have to click "List files" first.

import { useEffect, useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useQueryStore } from "../../store/queryStore";
import { usePreviewStore } from "../../store/previewStore";
import { useStepStore } from "../../store/stepStore";
import { isFolderConnectionKind, type Connection } from "../../types/connection";
import { CONNECTION_BY_KIND } from "../../connections/kinds";
import {
  listSupportedFiles,
  readFolderFileBytes,
  pickDirectory,
  type FolderFile,
} from "../../lib/fileAccess";
import { registerFileBuffer } from "../../lib/duckdb";
import { sanitizeVirtualName } from "../../lib/fileReaders";
import { buildFolderFileQuerySql, buildFolderFileAttachSql, getFolderConnectionAlias } from "../../connections/kinds";

export function GetDataModal() {
  const open = useEditorStore((s) => s.getDataOpen);
  const close = useEditorStore((s) => s.closeGetData);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const connections = useConnectionStore((s) => s.connections);
  const linkFolder = useConnectionStore((s) => s.linkFolder);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const addStepByKind = useQueryStore((s) => s.addStepByKind);
  const updateStepConfig = useQueryStore((s) => s.updateStepConfig);
  const requestRun = usePreviewStore((s) => s.requestRun);

  const [connId, setConnId] = useState<string>("");
  const [files, setFiles] = useState<FolderFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // server table entry
  const [schema, setSchema] = useState("public");
  const [table, setTable] = useState("");

  const conn = connections.find((c) => c.id === connId) ?? null;

  // Auto-list files when opening the modal with an already-linked folder connection.
  useEffect(() => {
    if (!open || !conn || !isFolderConnectionKind(conn.kind)) return;
    if (conn.linkStatus === "linked" && files === null) {
      void listFiles(conn);
    }
  }, [open, conn, files]);

  // Reset local state when the modal closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setConnId("");
      setFiles(null);
      setError(null);
      setSchema("public");
      setTable("");
    }
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const listFiles = async (c: Connection) => {
    setBusy(true);
    setError(null);
    try {
      const dir = await useConnectionStore.getState().getFolderHandle(c.id);
      if (!dir) throw new Error("Folder is not linked");
      setFiles(await listSupportedFiles(dir));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const linkAndList = async (c: Connection) => {
    setBusy(true);
    setError(null);
    try {
      const dir = await pickDirectory();
      await linkFolder(c.id, dir);
      updateConnection(c.id, { config: { ...c.config, folderPath: dir.name, folderName: dir.name } });
      // linkFolder now refreshes + registers files; just list them for the UI.
      setFiles(await listSupportedFiles(dir));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addFileSource = async (f: FolderFile) => {
    if (!activeQueryId || !conn) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await readFolderFileBytes(f.handle);
      const virtualName = sanitizeVirtualName(f.name);
      await registerFileBuffer(virtualName, bytes);

      const folderPath = String(conn.config.folderPath ?? conn.config.folderName ?? "");
      const folderAlias = getFolderConnectionAlias(conn.config) || undefined;
      const attachSql = buildFolderFileAttachSql(folderPath, f.name, f.ext, {
        folderAlias,
      });
      const querySql = buildFolderFileQuerySql(folderPath, f.name, f.ext, {
        folderAlias,
      });

      const step = addStepByKind(activeQueryId, "source_file", f.name);
      if (step) {
        updateStepConfig(activeQueryId, step.id, {
          sourceVirtual: virtualName,
          sourceName: f.name,
          ext: f.ext,
          relPath: f.relPath,
          connectionId: conn.id,
          folderPath,
          folderAlias,
          attachSql,
          querySql,
        });
        useStepStore.getState().refresh();
        useEditorStore.getState().setActiveStep(step.id);
        requestRun();
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addServerSource = () => {
    if (!activeQueryId || !conn || !table) return;
    const step = addStepByKind(activeQueryId, "source_connection", `${schema}.${table}`);
    if (step) {
      updateStepConfig(activeQueryId, step.id, { schema, table, connectionId: conn.id });
      useStepStore.getState().refresh();
      useEditorStore.getState().setActiveStep(step.id);
      requestRun();
    }
    close();
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: "min(640px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Get Data</span>
          <button className="step-icon-btn" title="Close" onClick={close}>✕</button>
        </div>
        <div className="step-dialog-body">
          {!activeQueryId && <p className="step-error">Select a query first.</p>}
          <label className="step-field">
            <span className="step-field-label">Connection</span>
            <select
              className="step-input"
              value={connId}
              onChange={(e) => { setConnId(e.target.value); setFiles(null); setError(null); }}
            >
              <option value="">(select a connection)</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} · {CONNECTION_BY_KIND[c.kind]?.label ?? c.kind}
                </option>
              ))}
            </select>
          </label>

          {conn && isFolderConnectionKind(conn.kind) && (
            <>
              {conn.linkStatus === "linked" ? (
                <button onClick={() => listFiles(conn)} disabled={busy}>
                  {files ? "Refresh file list" : "List files"}
                </button>
              ) : (
                <button onClick={() => linkAndList(conn)} disabled={busy}>
                  Link folder & list files
                </button>
              )}
              {files && (
                <div className="step-rows" style={{ maxHeight: 320, overflowY: "auto" }}>
                  {files.length === 0 && <p className="step-field-hint">No supported files in this folder.</p>}
                  {files.map((f) => (
                    <button
                      key={f.relPath}
                      className="step-row"
                      style={{
                        justifyContent: "space-between",
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        marginBottom: 4,
                        padding: "6px 8px",
                        cursor: "pointer",
                      }}
                      onClick={() => addFileSource(f)}
                      disabled={busy}
                      title="Use this file as the query source"
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.relPath}</span>
                      <span style={{ flexShrink: 0, marginLeft: 8, color: "var(--accent)" }}>Add →</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {conn && !isFolderConnectionKind(conn.kind) && (
            <>
              <p className="step-field-hint">
                {CONNECTION_BY_KIND[conn.kind]?.scriptOnly
                  ? "Server connections are script-only — the source SQL is emitted for desktop DuckDB, not run in the browser."
                  : ""}
              </p>
              <label className="step-field">
                <span className="step-field-label">Schema</span>
                <input className="step-input" value={schema} onChange={(e) => setSchema(e.target.value)} />
              </label>
              <label className="step-field">
                <span className="step-field-label">Table</span>
                <input className="step-input" value={table} onChange={(e) => setTable(e.target.value)} placeholder="table name" />
              </label>
              <div className="step-dialog-actions">
                <button className="primary" onClick={addServerSource} disabled={!table}>Add source</button>
              </div>
            </>
          )}

          {busy && <p className="step-field-hint">Working…</p>}
          {error && <div className="step-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
