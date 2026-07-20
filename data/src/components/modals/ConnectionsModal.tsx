// Connections manager modal: list/create/edit/delete connections.
//
// Two views share one modal:
//  - List: existing connections with edit/delete and folder link/unlink.
//  - Form: create a new connection (draft) or edit an existing one.
//
// A NEW connection is held as an in-memory draft until Save — picking a kind
// from "+ New connection" does NOT persist anything, so Cancel cleanly discards
// it (no dangling empty connection). Save validates required fields (display
// name; folder requires a chosen folder; any field marked required), persists
// via addConnection/updateConnection, and links a freshly-picked folder handle.
// Server (script-only) kinds show a plain-text password warning.
//
// Folder connections get a "Choose folder" picker (File System Access API) in
// the form; the handle is persisted in IDB by lib/fileAccess and only the
// folder name is stored in the project JSON. Server kinds are config-only
// (script-only — emitted for desktop DuckDB export, not run in WASM).

import { useEffect, useState } from "react";
import { useConnectionStore } from "../../store/connectionStore";
import { CONNECTION_BY_KIND } from "../../connections/kinds";
import {
  isFolderConnectionKind,
  type Connection,
  type ConnectionKind,
} from "../../types/connection";
import { pickDirectory, isFileSystemAccessSupported } from "../../lib/fileAccess";
import { LinkIcon, BrokenLinkIcon } from "../icons/LinkIcons";

export function ConnectionsModal() {
  const modalOpen = useConnectionStore((s) => s.modalOpen);
  const editingId = useConnectionStore((s) => s.editingId);
  const connections = useConnectionStore((s) => s.connections);
  const closeModal = useConnectionStore((s) => s.closeModal);
  const openModal = useConnectionStore((s) => s.openModal);

  // Kind chosen from "+ New connection" but not yet saved (draft). Cleared on
  // save/cancel/back and whenever the modal closes.
  const [pendingKind, setPendingKind] = useState<ConnectionKind | null>(null);

  useEffect(() => {
    if (!modalOpen) setPendingKind(null);
  }, [modalOpen]);

  if (!modalOpen) return null;

  const editing = editingId ? connections.find((c) => c.id === editingId) ?? null : null;
  const inForm = Boolean(editing) || Boolean(pendingKind);

  // "Back to list": drop the draft / edit target but keep the modal open.
  const backToList = () => {
    setPendingKind(null);
    openModal();
  };

  // Overlay / ✕: from the list, exit the modal; from a form, return to the
  // list (matching Cancel) instead of silently discarding the draft.
  const requestClose = () => (inForm ? backToList() : closeModal());

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connections"
        style={{ width: "min(900px, 92%)", height: "min(640px, 86vh)", maxHeight: "86vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Connections</span>
          <button className="step-icon-btn" title="Close" onClick={requestClose}>✕</button>
        </div>
        {editing ? (
          <ConnectionForm existing={editing} onDone={backToList} />
        ) : pendingKind ? (
          <ConnectionForm kind={pendingKind} onDone={backToList} />
        ) : (
          <ConnectionsList
            connections={connections}
            onEdit={(id) => openModal(id)}
            onNewKind={(kind) => setPendingKind(kind)}
          />
        )}
      </div>
    </div>
  );
}

function ConnectionsList({
  connections,
  onEdit,
  onNewKind,
}: {
  connections: Connection[];
  onEdit: (id: string) => void;
  onNewKind: (kind: ConnectionKind) => void;
}) {
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const linkFolder = useConnectionStore((s) => s.linkFolder);
  const unlinkFolder = useConnectionStore((s) => s.unlinkFolder);
  const [showKindPicker, setShowKindPicker] = useState(false);
  const fsaSupported = isFileSystemAccessSupported();

  const handleLink = async (conn: Connection) => {
    try {
      const dir = await pickDirectory();
      await linkFolder(conn.id, dir);
      useConnectionStore.getState().updateConnection(conn.id, {
        config: { ...conn.config, folderPath: dir.name, folderName: dir.name },
      });
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      alert(`Could not link folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRefreshFiles = async (conn: Connection) => {
    try {
      await useConnectionStore.getState().refreshFolderFiles(conn.id);
    } catch (e) {
      alert(`Could not refresh files: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="step-dialog-body">
      {connections.length === 0 && (
        <p className="step-field-hint">No connections yet. Add a folder or server connection to get started.</p>
      )}
      <div className="connections-list">
        {connections.map((c) => {
          const def = CONNECTION_BY_KIND[c.kind];
          const isFolder = isFolderConnectionKind(c.kind);
          const linked = c.linkStatus === "linked";
          const broken = isFolder && !linked;
          const linkTitle = !isFolder
            ? undefined
            : linked
              ? "Folder linked"
              : fsaSupported
                ? "Folder not linked — click Link folder to re-link"
                : "Folder not linked — folder linking needs Chrome/Edge";
          return (
            <div key={c.id} className="connection-card">
              {isFolder && (
                <span
                  className={`connection-link-badge ${broken ? "broken" : "ok"}`}
                  title={linkTitle}
                  aria-label={linkTitle}
                >
                  {linked ? <LinkIcon size={16} /> : <BrokenLinkIcon size={16} />}
                </span>
              )}
              <div className="connection-card-info">
                <span className="connection-name">{c.displayName}</span>
                <span className="connection-kind">
                  {def?.label ?? c.kind}
                  {isFolder && ` · ${linked ? "linked" : "not linked"}`}
                </span>
              </div>
              <div className="connection-actions">
                {isFolder && (
                  linked ? (
                    <>
                      <button onClick={() => handleRefreshFiles(c)} title="Re-scan folder files">Refresh files</button>
                      <button onClick={() => unlinkFolder(c.id)} title="Unlink folder">Unlink</button>
                    </>
                  ) : (
                    <button
                      className="connect-btn broken"
                      onClick={() => handleLink(c)}
                      disabled={!fsaSupported}
                      title={fsaSupported ? "Link folder" : "Folder linking needs Chrome/Edge"}
                    >
                      Link folder
                    </button>
                  )
                )}
                <button className="step-icon-btn" title="Edit" onClick={() => onEdit(c.id)}>✎</button>
                <button className="step-icon-btn" title="Delete" onClick={() => deleteConnection(c.id)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="connection-new">
        <button
          onClick={() => setShowKindPicker((v) => !v)}
          aria-expanded={showKindPicker}
          aria-haspopup="listbox"
          title="Choose a connection type"
        >
          + New connection
        </button>
        {showKindPicker && (
          <>
            <div className="connection-picker-backdrop" onClick={() => setShowKindPicker(false)} />
            <div
              className="templates-dropdown connection-kind-dropdown"
              role="listbox"
            >
              {Object.values(CONNECTION_BY_KIND).map((def) => (
                <button
                  key={def.kind}
                  className="template-item"
                  role="option"
                  title={def.description}
                  onClick={() => {
                    setShowKindPicker(false);
                    onNewKind(def.kind);
                  }}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConnectionForm({
  kind,
  existing,
  onDone,
}: {
  kind?: ConnectionKind;
  existing?: Connection;
  onDone: () => void;
}) {
  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const linkFolder = useConnectionStore((s) => s.linkFolder);

  const resolvedKind = (existing?.kind ?? kind) as ConnectionKind;
  const def = CONNECTION_BY_KIND[resolvedKind];
  const isFolder = isFolderConnectionKind(resolvedKind);
  const fsaSupported = isFileSystemAccessSupported();

  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [config, setConfig] = useState<Record<string, unknown>>(
    existing?.config ?? { ...def?.defaultConfig },
  );
  // Folder handle picked in this form session (persisted only on Save).
  const [pendingHandle, setPendingHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folderName = String(config.folderName ?? "");
  const setField = (id: string, value: unknown) => setConfig((c) => ({ ...c, [id]: value }));

  const chooseFolder = async () => {
    try {
      const dir = await pickDirectory();
      setPendingHandle(dir);
      setConfig((c) => ({ ...c, folderName: dir.name, folderPath: dir.name }));
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      setError(`Could not pick folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const validate = (): string | null => {
    if (!displayName.trim()) return "Display name is required";
    if (isFolder) {
      if (fsaSupported) {
        // Need a freshly-picked handle for a new connection, or an existing
        // folder name when editing without re-picking.
        if (!pendingHandle && !folderName.trim()) return "Choose a folder for the connection";
      } else if (!folderName.trim()) {
        return "Folder name is required";
      }
      return null;
    }
    // Generic required-field check for server kinds.
    for (const f of def?.fields ?? []) {
      if (f.id === "displayName" || !f.required) continue;
      const v = config[f.id];
      if (v === undefined || v === null || String(v).trim() === "") {
        return `${f.label} is required`;
      }
    }
    // ODBC needs either a connection string or at least server/user fields.
    if (resolvedKind === "odbc") {
      const cs = String(config.connectionString ?? "").trim();
      const hasStructured =
        String(config.server ?? "").trim() || String(config.user ?? "").trim();
      if (!cs && !hasStructured) {
        return "Provide a connection string or at least server/user fields";
      }
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    let id: string;
    if (existing) {
      updateConnection(existing.id, { displayName: displayName.trim(), config });
      id = existing.id;
    } else {
      const conn = addConnection(resolvedKind, displayName.trim(), config);
      id = conn.id;
    }
    // Await the folder-link write so the list only re-renders once the handle
    // is stored (linkStatus "linked"), and surface IDB failures instead of
    // leaving the connection silently unlinked.
    if (isFolder && pendingHandle) {
      try {
        await linkFolder(id, pendingHandle);
      } catch (e) {
        setError(
          `Connection saved, but the folder handle could not be stored: ${e instanceof Error ? e.message : String(e)}. Use “Link folder” in the list to retry.`,
        );
        return;
      }
    }
    onDone();
  };

  const title = existing ? `Edit ${def?.label ?? resolvedKind}` : `New ${def?.label ?? resolvedKind} connection`;

  return (
    <div className="step-dialog-body connection-form">
      <div className="connection-form-title">
        <span className="connection-form-title-text">{title}</span>
        {def?.description && (
          <span className="step-field-hint">{def.description}</span>
        )}
      </div>
      {def?.scriptOnly && (
        <div className="step-error" role="note">
          Server connection — saved in your project JSON. Passwords are stored in
          plain text and the connection runs only in desktop DuckDB (not in the
          browser).
        </div>
      )}
      <label className="step-field">
        <span className="step-field-label">Display name</span>
        <input
          className="step-input"
          value={displayName}
          autoFocus
          placeholder={def?.label}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      {isFolder ? (
        <label className="step-field">
          <span className="step-field-label">Folder</span>
          {fsaSupported ? (
            <div className="connection-folder-row">
              <button type="button" onClick={chooseFolder}>Choose folder</button>
              <span className="step-field-hint">
                {folderName || "No folder selected"}
              </span>
            </div>
          ) : (
            <input
              className="step-input"
              type="text"
              value={folderName}
              placeholder="Folder name (display only)"
              onChange={(e) => setField("folderName", e.target.value)}
            />
          )}
          <span className="step-field-hint">
            {fsaSupported
              ? "Pick a folder to browse its data files. Only the folder name is stored in the project."
              : "Folder picker needs Chrome/Edge. Enter a folder name for display."}
          </span>
        </label>
      ) : (
        def?.fields.filter((f) => f.id !== "displayName").map((f) => (
          <label key={f.id} className="step-field">
            <span className="step-field-label">
              {f.label}{f.required ? " *" : ""}
            </span>
            {f.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={Boolean(config[f.id] ?? false)}
                onChange={(e) => setField(f.id, e.target.checked)}
              />
            ) : (
              <input
                className="step-input"
                type={f.type === "password" ? "password" : "text"}
                value={String(config[f.id] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            )}
          </label>
        ))
      )}
      {error && <div className="step-error" role="alert">{error}</div>}
      <div className="step-dialog-actions">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}