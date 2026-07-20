import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";
import { useConnectionStore } from "../../store/connectionStore";
import { isFolderConnectionKind } from "../../types/connection";
import { LinkIcon, BrokenLinkIcon } from "../icons/LinkIcons";
import { AiIcon } from "../icons/AiIcon";

export function Header() {
  const toggleLeft = useEditorStore((s) => s.toggleLeftPanel);
  const toggleRight = useEditorStore((s) => s.toggleRightPanel);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const openAi = useEditorStore((s) => s.openAi);
  const queries = useQueryStore((s) => s.queries);
  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const openConnectionModal = useConnectionStore((s) => s.openModal);
  const connections = useConnectionStore((s) => s.connections);

  // A folder connection is "broken" when it has no usable directory handle
  // (e.g. after the browser cache / IndexedDB was cleared). The connect button
  // shows a broken-link icon in that case so the user knows to re-link.
  const folderConns = connections.filter((c) => isFolderConnectionKind(c.kind));
  const brokenCount = folderConns.filter((c) => c.linkStatus !== "linked").length;
  const hasBroken = brokenCount > 0;

  const title = hasBroken
    ? `${brokenCount} folder connection${brokenCount > 1 ? "s" : ""} need re-linking — click to open Connections`
    : "Manage connections (folders & servers)";

  return (
    <header className="app-header">
      <button onClick={toggleLeft} title="Toggle Explorer">☰</button>
      <h1>ETL Studio</h1>
      {activeQuery && (
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          / {activeQuery.name}
        </span>
      )}
      <a
        href="README.html"
        target="_blank"
        title="README"
        className="header-doc-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </a>
      <a
        href="docs.html"
        target="_blank"
        title="Documentation"
        className="header-doc-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </a>
      <a
        href="mailto:hello@pyaek.com"
        title="Contact hello@pyaek.com"
        className="header-doc-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M22 4L12 13 2 4" />
        </svg>
      </a>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => openConnectionModal()}
        title={title}
        className={`connect-btn ${hasBroken ? "broken" : ""}`}
        style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
      >
        {hasBroken ? <BrokenLinkIcon size={14} /> : <LinkIcon size={14} />}
        <span>Connect</span>
      </button>
      <button
        onClick={openAi}
        title="Open AI assist (Ollama / Claude)"
        className="connect-btn"
        style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
      >
        <AiIcon size={14} />
        <span>AI</span>
      </button>
      <button onClick={toggleRight} title="Toggle Steps">⋮</button>
    </header>
  );
}