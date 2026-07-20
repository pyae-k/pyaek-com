import { create } from "zustand";
import type { Query, Folder, Step, StepKind } from "../types/query";
import type { HistoryEntry } from "../types/etlstudio";
import { getStepDef, getDefaultConfig, regenerateStepSql, makeBuildSqlContext } from "../steps";

interface QueryState {
  queries: Query[];
  folders: Folder[];
  history: HistoryEntry[];
  searchQuery: string;
  loaded: boolean;

  setSearchQuery: (q: string) => void;
  setLoaded: (b: boolean) => void;
  loadFromData: (queries: Query[], folders: Folder[], history: HistoryEntry[]) => void;
  getQuery: (id: string) => Query | undefined;
  getSteps: (queryId: string) => Step[];
  createQuery: (name: string, folderId?: string | null) => Query;
  renameQuery: (id: string, name: string) => void;
  duplicateQuery: (id: string) => Query | null;
  deleteQuery: (id: string) => void;
  bulkDelete: (ids: string[]) => void;
  toggleQuery: (id: string) => void;
  moveQuery: (id: string, direction: "up" | "down") => void;
  setQueryFolder: (id: string, folderId: string | null) => void;
  reorderQueries: (orderedIds: string[]) => void;
  addStep: (
    queryId: string,
    stepKind: StepKind,
    name: string,
    sql: string,
    config?: Record<string, unknown>,
  ) => Step | null;
  /** Add a step from the catalog: uses the kind's defaultConfig + regenerates SQL. */
  addStepByKind: (queryId: string, stepKind: StepKind, name?: string) => Step | null;
  /** Replace a step's config and regenerate its SQL (custom_sql preserves hand-edited SQL). */
  updateStepConfig: (queryId: string, stepId: string, config: Record<string, unknown>) => void;
  renameStep: (queryId: string, stepId: string, name: string) => void;
  setStepSQL: (queryId: string, stepId: string, sql: string) => void;
  deleteStep: (queryId: string, stepId: string) => void;
  reorderSteps: (queryId: string, orderedIds: string[]) => void;
  toggleStep: (queryId: string, stepId: string) => void;
  cloneStep: (queryId: string, stepId: string) => Step | null;
  createFolder: (name: string, parentId?: string | null) => Folder;
  deleteFolder: (id: string) => void;
  addHistory: (entry: HistoryEntry) => void;
}

function uid(): string {
  return crypto.randomUUID();
}

function cteName(index: number): string {
  return `step_${String(index + 1).padStart(2, "0")}`;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  queries: [],
  folders: [],
  history: [],
  searchQuery: "",
  loaded: false,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setLoaded: (b) => set({ loaded: b }),

  loadFromData: (queries, folders, history) => {
    set({ queries, folders, history, loaded: true });
  },

  getQuery: (id) => get().queries.find((q) => q.id === id),

  getSteps: (queryId) => {
    const q = get().queries.find((qq) => qq.id === queryId);
    return q?.steps ?? [];
  },

  createQuery: (name, folderId = null) => {
    const now = Date.now();
    const sameFolder = get().queries.filter((q) => q.folderId === folderId);
    const query: Query = {
      id: uid(),
      name,
      folderId,
      enabled: true,
      order: sameFolder.length,
      createdAt: now,
      updatedAt: now,
      steps: [],
    };
    set({ queries: [...get().queries, query] });
    get().addHistory({ timestamp: Date.now(), action: "create_query", queryId: query.id });
    return query;
  },

  renameQuery: (id, name) => {
    set({
      queries: get().queries.map((q) =>
        q.id === id ? { ...q, name, updatedAt: Date.now() } : q
      ),
    });
    get().addHistory({ timestamp: Date.now(), action: "rename_query", queryId: id });
  },

  duplicateQuery: (id) => {
    const original = get().queries.find((q) => q.id === id);
    if (!original) return null;
    const now = Date.now();
    const copy: Query = {
      ...original,
      id: uid(),
      name: `${original.name} (copy)`,
      order: get().queries.filter((q) => q.folderId === original.folderId).length,
      createdAt: now,
      updatedAt: now,
      steps: original.steps.map(s => ({ ...s, id: uid() })),
    };
    set({ queries: [...get().queries, copy] });
    return copy;
  },

  deleteQuery: (id) => {
    const remaining = get().queries.filter((q) => q.id !== id);
    for (let i = 0; i < remaining.length; i++) remaining[i].order = i;
    set({ queries: remaining });
    get().addHistory({ timestamp: Date.now(), action: "delete_query", queryId: id });
  },

  bulkDelete: (ids) => {
    set({ queries: get().queries.filter((q) => !ids.includes(q.id)) });
  },

  toggleQuery: (id) => {
    set({
      queries: get().queries.map((q) =>
        q.id === id ? { ...q, enabled: !q.enabled } : q
      ),
    });
  },

  moveQuery: (id, direction) => {
    const queries = [...get().queries].sort((a, b) => a.order - b.order);
    const idx = queries.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= queries.length) return;
    const tmp = queries[idx].order;
    queries[idx].order = queries[swapIdx].order;
    queries[swapIdx].order = tmp;
    set({ queries: [...queries] });
  },

  setQueryFolder: (id, folderId) => {
    set({
      queries: get().queries.map((q) =>
        q.id === id ? { ...q, folderId, updatedAt: Date.now() } : q
      ),
    });
  },

  reorderQueries: (orderedIds) => {
    const queries = get().queries;
    const reordered = orderedIds
      .map((id, i) => {
        const q = queries.find((qq) => qq.id === id);
        return q ? { ...q, order: i } : null;
      })
      .filter(Boolean) as Query[];
    const unchanged = queries.filter((q) => !orderedIds.includes(q.id));
    set({ queries: [...unchanged, ...reordered] });
  },

  addStep: (queryId, stepKind, name, sql, config = {}) => {
    const queries = get().queries;
    const q = queries.find((qq) => qq.id === queryId);
    if (!q) return null;
    const step: Step = {
      id: uid(),
      name,
      stepKind,
      config,
      enabled: true,
      order: q.steps.length,
      sql,
    };
    set({
      queries: queries.map((qq) =>
        qq.id === queryId ? { ...qq, steps: [...qq.steps, step], updatedAt: Date.now() } : qq
      ),
    });
    return step;
  },

  addStepByKind: (queryId, stepKind, name) => {
    const queries = get().queries;
    const q = queries.find((qq) => qq.id === queryId);
    if (!q) return null;
    const def = getStepDef(stepKind);
    const config = getDefaultConfig(stepKind);
    const enabledBefore = q.steps.filter((s) => s.enabled).length;
    const index = enabledBefore;
    const prevRef = index > 0 ? cteName(index - 1) : "";
    const draft: Step = {
      id: uid(),
      name: name ?? def?.name ?? stepKind,
      stepKind,
      config,
      enabled: true,
      order: q.steps.length,
      sql: "",
    };
    const sql = regenerateStepSql(draft, makeBuildSqlContext(prevRef, index));
    const step: Step = { ...draft, sql };
    set({
      queries: queries.map((qq) =>
        qq.id === queryId ? { ...qq, steps: [...qq.steps, step], updatedAt: Date.now() } : qq
      ),
    });
    get().addHistory({ timestamp: Date.now(), action: "add_step", queryId, snapshot: { id: step.id, name: step.name } });
    return step;
  },

  updateStepConfig: (queryId, stepId, config) => {
    set({
      queries: get().queries.map((q) => {
        if (q.id !== queryId) return q;
        const enabledSteps = q.steps.filter((s) => s.enabled);
        return {
          ...q,
          steps: q.steps.map((s) => {
            if (s.id !== stepId) return s;
            const idx = enabledSteps.findIndex((ss) => ss.id === stepId);
            const index = idx >= 0 ? idx : enabledSteps.length;
            const prevRef = index > 0 ? cteName(index - 1) : "";
            const updated = { ...s, config };
            const sql = regenerateStepSql(updated, makeBuildSqlContext(prevRef, index));
            return { ...updated, sql };
          }),
          updatedAt: Date.now(),
        };
      }),
    });
  },

  renameStep: (queryId, stepId, name) => {
    set({
      queries: get().queries.map((q) =>
        q.id === queryId
          ? { ...q, steps: q.steps.map((s) => (s.id === stepId ? { ...s, name } : s)) }
          : q
      ),
    });
  },

  setStepSQL: (queryId, stepId, sql) => {
    set({
      queries: get().queries.map((q) =>
        q.id === queryId
          ? { ...q, steps: q.steps.map((s) => (s.id === stepId ? { ...s, sql } : s)), updatedAt: Date.now() }
          : q
      ),
    });
  },

  deleteStep: (queryId, stepId) => {
    set({
      queries: get().queries.map((q) => {
        if (q.id !== queryId) return q;
        const remaining = q.steps.filter((s) => s.id !== stepId);
        for (let i = 0; i < remaining.length; i++) remaining[i].order = i;
        return { ...q, steps: remaining, updatedAt: Date.now() };
      }),
    });
    get().addHistory({ timestamp: Date.now(), action: "delete_step", queryId });
  },

  reorderSteps: (queryId, orderedIds) => {
    set({
      queries: get().queries.map((q) => {
        if (q.id !== queryId) return q;
        const reordered = orderedIds
          .map((id, i) => {
            const s = q.steps.find((ss) => ss.id === id);
            return s ? { ...s, order: i } : null;
          })
          .filter(Boolean) as Step[];
        return { ...q, steps: reordered, updatedAt: Date.now() };
      }),
    });
  },

  toggleStep: (queryId, stepId) => {
    set({
      queries: get().queries.map((q) =>
        q.id === queryId
          ? { ...q, steps: q.steps.map((s) => (s.id === stepId ? { ...s, enabled: !s.enabled } : s)) }
          : q
      ),
    });
  },

  cloneStep: (queryId, stepId) => {
    const q = get().queries.find((qq) => qq.id === queryId);
    if (!q) return null;
    const original = q.steps.find((s) => s.id === stepId);
    if (!original) return null;
    const copy: Step = {
      ...original,
      id: uid(),
      name: `${original.name} (copy)`,
      order: q.steps.length,
    };
    set({
      queries: get().queries.map((qq) =>
        qq.id === queryId ? { ...qq, steps: [...qq.steps, copy], updatedAt: Date.now() } : qq
      ),
    });
    return copy;
  },

  createFolder: (name, parentId = null) => {
    const folder: Folder = { id: uid(), name, parentId };
    set({ folders: [...get().folders, folder] });
    return folder;
  },

  deleteFolder: (id) => {
    set({
      folders: get().folders.filter((f) => f.id !== id),
      queries: get().queries.map((q) =>
        q.folderId === id ? { ...q, folderId: null } : q
      ),
    });
  },

  addHistory: (entry) => {
    const history = [...get().history, entry].slice(-50);
    set({ history });
  },
}));

export { cteName };