import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryStore } from "../../store/queryStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { usePreviewStore } from "../../store/previewStore";
import { executeBatch } from "../../engine/executor";
import type { Query } from "../../types/query";

export function LeftPanel() {
  const queries = useQueryStore((s) => s.queries);
  const folders = useQueryStore((s) => s.folders);
  const searchQuery = useQueryStore((s) => s.searchQuery);
  const setSearchQuery = useQueryStore((s) => s.setSearchQuery);
  const createQuery = useQueryStore((s) => s.createQuery);
  const createFolder = useQueryStore((s) => s.createFolder);
  const reorderQueries = useQueryStore((s) => s.reorderQueries);
  const setQueryFolder = useQueryStore((s) => s.setQueryFolder);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const setActiveQuery = useEditorStore((s) => s.setActiveQuery);
  const openStepCatalog = useEditorStore((s) => s.openStepCatalog);
  const selectedQueryIds = useEditorStore((s) => s.selectedQueryIds);
  const setSelectedQueryIds = useEditorStore((s) => s.setSelectedQueryIds);
  const fileStatus = useFileStore((s) => s.status);
  const connected = fileStatus === "connected";
  const enabledCount = queries.filter((q) => q.enabled).length;
  const setRunAllStatus = usePreviewStore((s) => s.setRunAllStatus);
  const updateRunStatus = usePreviewStore((s) => s.updateRunStatus);
  const setRunAllActive = usePreviewStore((s) => s.setRunAllActive);
  const [running, setRunning] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const sortedQueries = [...queries].sort((a, b) => a.order - b.order);
  const rootQueries = sortedQueries.filter((q) => !q.folderId);
  const rootIds = rootQueries.map((q) => q.id);
  const filtered = searchQuery
    ? sortedQueries.filter((q) => q.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  const handleNew = async () => {
    const name = prompt("Query name:", "New Query");
    if (!name) return;
    const q = createQuery(name.trim());
    setActiveQuery(q.id);
    openStepCatalog();
  };

  const handleNewFolder = async () => {
    const name = prompt("Folder name:", "New Folder");
    if (!name) return;
    await createFolder(name);
  };

  const handleSelect = (id: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = selectedQueryIds.includes(id)
        ? selectedQueryIds.filter((x) => x !== id)
        : [...selectedQueryIds, id];
      setSelectedQueryIds(next);
    } else if (e.shiftKey && selectedQueryIds.length > 0) {
      const indices = sortedQueries.map((q) => q.id);
      const start = indices.indexOf(selectedQueryIds[0]);
      const end = indices.indexOf(id);
      const range = indices.slice(Math.min(start, end), Math.max(start, end) + 1);
      setSelectedQueryIds(range);
    } else {
      setSelectedQueryIds([id]);
      setActiveQuery(id);
    }
  };

  const handleRunAll = async () => {
    if (running) return;
    setRunning(true);
    setRunAllActive(true);
    const enabled = queries.filter((q) => q.enabled && q.steps.length > 0);
    setRunAllStatus(enabled.map((q) => ({
      queryId: q.id,
      queryName: q.name,
      status: "pending" as const,
    })));
    try {
      await executeBatch(queries, queries, (queryId, patch) => {
        updateRunStatus(queryId, patch);
      });
    } catch (e) {
      console.error("Run all failed:", e);
    } finally {
      setRunning(false);
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setDragId(e.active.id as string);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const folder = folders.find((f) => f.id === overId);
    if (folder) {
      await setQueryFolder(activeId, folder.id);
      return;
    }

    const rootDrop = overId === "root-drop-zone";
    if (rootDrop) {
      await setQueryFolder(activeId, null);
      return;
    }

    const newOrder = arrayMove(rootIds, rootIds.indexOf(activeId), rootIds.indexOf(overId));
    await reorderQueries(newOrder);
  };

  if (filtered) {
    return (
      <>
        <PanelHeader
          onNewQuery={handleNew}
          onNewFolder={handleNewFolder}
          onRunAll={handleRunAll}
          running={running}
          enabledCount={enabledCount}
          connected={connected}
        />
        <input
          className="search-input"
          placeholder="Search queries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <ul className="query-list">
          {filtered.map((q) => (
            <QueryCard
              key={q.id}
              query={q}
              isActive={q.id === activeQueryId}
              isSelected={selectedQueryIds.includes(q.id)}
              onSelect={(e) => handleSelect(q.id, e)}
              showActions={false}
            />
          ))}
          {filtered.length === 0 && (
            <li style={{ padding: "8px", color: "var(--text-muted)" }}>No matches</li>
          )}
        </ul>
      </>
    );
  }

  const dragQuery = dragId ? queries.find((q) => q.id === dragId) : null;

  return (
    <>
      <PanelHeader
        onNewQuery={handleNew}
        onNewFolder={handleNewFolder}
        onRunAll={handleRunAll}
        running={running}
        enabledCount={enabledCount}
        connected={connected}
      />
      <input
        className="search-input"
        placeholder="Search queries..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
          <ul className="query-list">
            {rootQueries.map((q) => (
              <SortableQueryCard
                key={q.id}
                query={q}
                isActive={q.id === activeQueryId}
                isSelected={selectedQueryIds.includes(q.id)}
                onSelect={(e) => handleSelect(q.id, e)}
              />
            ))}
            {folders.map((f) => (
              <SortableFolderGroup
                key={f.id}
                folder={f}
                queries={sortedQueries.filter((q) => q.folderId === f.id)}
                activeQueryId={activeQueryId}
                selectedQueryIds={selectedQueryIds}
                onSelect={handleSelect}
              />
            ))}
            <RootDropZone />
            {rootQueries.length === 0 && folders.length === 0 && (
              <li style={{ padding: "8px", color: "var(--text-muted)" }}>No queries yet</li>
            )}
          </ul>
        </SortableContext>
        <DragOverlay>
          {dragQuery && (
            <div className="query-item drag-overlay" style={{ opacity: 0.8 }}>
              <span>📄</span>
              <span>{dragQuery.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: "root-drop-zone" });
  return (
    <div
      ref={setNodeRef}
      className={`root-drop-zone ${isOver ? "active" : ""}`}
    >
      Drop here for root
    </div>
  );
}

function PanelHeader({
  onNewQuery,
  onNewFolder,
  onRunAll,
  running,
  enabledCount,
  connected,
}: {
  onNewQuery: () => void;
  onNewFolder: () => void;
  onRunAll: () => void;
  running: boolean;
  enabledCount: number;
  connected: boolean;
}) {
  const runAllStatus = usePreviewStore((s) => s.runAllStatus);
  const completedCount = runAllStatus.filter((r) => r.status === "completed").length;
  const failedCount = runAllStatus.filter((r) => r.status === "failed").length;

  return (
    <div className="panel-header">
      <span>Queries</span>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {runAllStatus.length > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {completedCount}/{runAllStatus.length}
            {failedCount > 0 ? ` (${failedCount} failed)` : ""}
          </span>
        )}
        <button
          onClick={onRunAll}
          disabled={!connected || running || enabledCount === 0}
          title={running ? "Running all queries..." : "Run all enabled queries"}
          style={{ fontSize: 12 }}
        >
          {running ? "⏳" : "▶"}
        </button>
        <button onClick={onNewFolder} title="New folder" disabled={!connected}>📁+</button>
        <button onClick={onNewQuery} title="New query from data source" disabled={!connected}>+</button>
      </div>
    </div>
  );
}

function SortableQueryCard({
  query,
  isActive,
  isSelected,
  onSelect,
}: {
  query: Query;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: query.id,
  });
  const renameQuery = useQueryStore((s) => s.renameQuery);
  const duplicateQuery = useQueryStore((s) => s.duplicateQuery);
  const deleteQuery = useQueryStore((s) => s.deleteQuery);
  const toggleQuery = useQueryStore((s) => s.toggleQuery);
  const setQueryFolder = useQueryStore((s) => s.setQueryFolder);
  const folders = useQueryStore((s) => s.folders);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(query.name);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const commitRename = async () => {
    setEditing(false);
    if (draft.trim() && draft !== query.name) {
      await renameQuery(query.id, draft.trim());
    } else {
      setDraft(query.name);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`query-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${!query.enabled ? "disabled" : ""}`}
      onClick={onSelect}
    >
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: "grab", flexShrink: 0, padding: "0 2px" }}
        title="Drag to reorder or move to folder"
      >⠿</span>
      <span style={{ flexShrink: 0 }}>📄</span>
      {editing ? (
        <input
          className="step-card-name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setEditing(false); setDraft(query.name); }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(query.name); }}
          title="Double-click to rename"
        >
          {query.name}
        </span>
      )}
      <div className="query-card-actions" onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <button className="step-icon-btn" onClick={() => setShowMoveMenu((v) => !v)} title="Move to folder">→</button>
          {showMoveMenu && (
            <div className="move-dropdown">
              <button className="template-item" onClick={() => { setQueryFolder(query.id, null); setShowMoveMenu(false); }}>
                Root (no folder)
              </button>
              {folders.map((f) => (
                <button key={f.id} className="template-item" onClick={() => { setQueryFolder(query.id, f.id); setShowMoveMenu(false); }}>
                  📁 {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="step-icon-btn" onClick={() => toggleQuery(query.id)} title={query.enabled ? "Disable" : "Enable"}>
          {query.enabled ? "●" : "○"}
        </button>
        <button className="step-icon-btn" onClick={() => duplicateQuery(query.id)} title="Duplicate">⧉</button>
        <button className="step-icon-btn" onClick={() => { if (confirm("Delete this query?")) deleteQuery(query.id); }} title="Delete">✕</button>
      </div>
    </li>
  );
}

function QueryCard({
  query,
  isActive,
  isSelected,
  onSelect,
  showActions,
}: {
  query: Query;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  showActions: boolean;
}) {
  return (
    <li
      className={`query-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${!query.enabled ? "disabled" : ""}`}
      onClick={onSelect}
      style={{ opacity: query.enabled ? 1 : 0.5 }}
    >
      <span style={{ flexShrink: 0 }}>📄</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {query.name}
      </span>
      {showActions && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>drag disabled in search</span>}
    </li>
  );
}

function SortableFolderGroup({
  folder,
  queries,
  activeQueryId,
  selectedQueryIds,
  onSelect,
}: {
  folder: { id: string; name: string };
  queries: Query[];
  activeQueryId: string | null;
  selectedQueryIds: string[];
  onSelect: (id: string, e: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: folder.id });
  const [expanded, setExpanded] = useState(true);
  const deleteFolder = useQueryStore((s) => s.deleteFolder);

  const folderQueryIds = queries.map((q) => q.id);

  return (
    <li style={{ listStyle: "none" }}>
      <div
        ref={setNodeRef}
        className={`folder-header ${isOver ? "drop-target" : ""}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ cursor: "pointer" }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ flex: 1 }}>📁 {folder.name}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{queries.length}</span>
        <button
          className="step-icon-btn"
          onClick={(e) => { e.stopPropagation(); if (confirm("Delete folder? Queries will move to root.")) deleteFolder(folder.id); }}
          title="Delete folder"
        >✕</button>
      </div>
      {expanded && (
        <SortableContext items={folderQueryIds} strategy={verticalListSortingStrategy}>
          <ul className="query-list" style={{ paddingLeft: 16 }}>
            {queries.map((q) => (
              <SortableQueryCard
                key={q.id}
                query={q}
                isActive={q.id === activeQueryId}
                isSelected={selectedQueryIds.includes(q.id)}
                onSelect={(e) => onSelect(q.id, e)}
              />
            ))}
            {queries.length === 0 && (
              <li style={{ padding: "4px 8px", color: "var(--text-muted)", fontSize: 12 }}>
                Empty folder — drag queries here
              </li>
            )}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}