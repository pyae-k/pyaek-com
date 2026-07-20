import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { useStepStore } from "../../store/stepStore";
import { useFileStore } from "../../store/fileStore";
import type { Step } from "../../types/query";

export function RightPanel() {
  const deleteStep = useQueryStore((s) => s.deleteStep);
  const toggleStep = useQueryStore((s) => s.toggleStep);
  const cloneStep = useQueryStore((s) => s.cloneStep);
  const reorderSteps = useQueryStore((s) => s.reorderSteps);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const activeStepId = useEditorStore((s) => s.activeStepId);
  const setActiveStep = useEditorStore((s) => s.setActiveStep);
  const setActiveQuery = useEditorStore((s) => s.setActiveQuery);
  const openStepDialog = useEditorStore((s) => s.openStepDialog);
  const fileStatus = useFileStore((s) => s.status);
  const connected = fileStatus === "connected";

  const steps = useStepStore((s) => s.steps);
  const createQuery = useQueryStore((s) => s.createQuery);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const openStepCatalog = useEditorStore((s) => s.openStepCatalog);

  const handleAdd = () => {
    if (!connected) return;
    // No query selected yet — create one on the fly so the "+" button always
    // does something useful instead of being a dead, disabled control.
    if (!activeQueryId) {
      const name = prompt("Query name:", "New Query");
      if (!name) return;
      const q = createQuery(name.trim());
      setActiveQuery(q.id);
    }
    // Open the step catalog picker so the user chooses a step kind (source,
    // rename, sort, aggregate, …) and configures it through a UI dialog —
    // step-by-step data transformation — rather than dropping a raw SQL step.
    openStepCatalog();
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !activeQueryId) return;
    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    const newOrder = arrayMove(steps, oldIndex, newIndex);
    reorderSteps(activeQueryId, newOrder.map((s) => s.id));
    useStepStore.getState().refresh();
  };

  return (
    <>
      <div className="panel-header">
        <span>Steps</span>
        <button
          onClick={handleAdd}
          title="Add a step"
          disabled={!connected}
        >
          +
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="step-list">
            {steps.map((s, i) => (
              <SortableStepCard
                key={s.id}
                step={s}
                index={i}
                isActive={s.id === activeStepId}
                queryId={activeQueryId!}
                onSelect={() => setActiveStep(s.id)}
                onEdit={() => openStepDialog(s.id)}
                onToggle={() => { toggleStep(activeQueryId!, s.id); useStepStore.getState().refresh(); }}
                onDelete={() => { deleteStep(activeQueryId!, s.id); useStepStore.getState().refresh(); }}
                onClone={() => { cloneStep(activeQueryId!, s.id); useStepStore.getState().refresh(); }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {steps.length === 0 && (
        <div className="placeholder">
          {activeQueryId
            ? "No steps yet. Click + to start with From connection, From query, or Custom SQL."
            : "Select a query first."}
        </div>
      )}
    </>
  );
}

function SortableStepCard({
  step,
  index,
  isActive,
  queryId,
  onSelect,
  onEdit,
  onToggle,
  onDelete,
  onClone,
}: {
  step: Step;
  index: number;
  isActive: boolean;
  queryId: string;
  onSelect: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onClone: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const renameStep = useQueryStore((s) => s.renameStep);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const commitRename = async () => {
    setEditing(false);
    if (draft.trim() && draft !== step.name) {
      renameStep(queryId, step.id, draft.trim());
      useStepStore.getState().refresh();
    } else {
      setDraft(step.name);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`step-card ${isActive ? "active" : ""} ${!step.enabled ? "disabled" : ""}`}
      onClick={onSelect}
    >
      <div className="step-card-header">
        <span
          {...attributes}
          {...listeners}
          style={{ cursor: "grab", flexShrink: 0, padding: "0 4px" }}
          title="Drag to reorder"
        >
          ⠿
        </span>
        <span style={{ flexShrink: 0, minWidth: 20 }}>{index + 1}.</span>
        {editing ? (
          <input
            className="step-card-name-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditing(false); setDraft(step.name); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="step-card-name"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(step.name); }}
            title="Double-click to rename"
          >
            {step.name}
          </span>
        )}
        <div className="step-card-actions">
          {step.stepKind !== "custom_sql" && (
            <button
              className="step-icon-btn"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title="Edit config"
            >
              ✎
            </button>
          )}
          <button
            className="step-icon-btn"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            title={step.enabled ? "Disable" : "Enable"}
          >
            {step.enabled ? "●" : "○"}
          </button>
          <button
            className="step-icon-btn"
            onClick={(e) => { e.stopPropagation(); onClone(); }}
            title="Clone step"
          >
            ⧉
          </button>
          <button
            className="step-icon-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete step"
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}
