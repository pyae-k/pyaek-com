import { create } from "zustand";
import type { ArrowResult, ColumnProfile } from "../types/engine";

export interface RunHistoryEntry {
  timestamp: number;
  queryId: string | null;
  stepId: string | null;
  rowCount: number;
  durationMs: number;
}

export interface QueryRunStatus {
  queryId: string;
  queryName: string;
  status: "pending" | "running" | "completed" | "failed";
  rowCount?: number;
  durationMs?: number;
  error?: string;
}

interface PreviewState {
  data: ArrowResult | null;
  profiles: ColumnProfile[];
  loading: boolean;
  error: string | null;
  durationMs: number;
  activeStepIndex: number;
  /** Incremented by requestRun() to force a manual preview (used when autoRun is off). */
  runNonce: number;
  runHistory: RunHistoryEntry[];
  /** Run-all state for batch execution of all enabled queries. */
  runAllStatus: QueryRunStatus[];
  runAllActive: boolean;
  setData: (data: ArrowResult | null) => void;
  setProfiles: (p: ColumnProfile[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setDuration: (ms: number) => void;
  setActiveStepIndex: (i: number) => void;
  requestRun: () => void;
  pushRun: (entry: Omit<RunHistoryEntry, "timestamp">) => void;
  reset: () => void;
  setRunAllStatus: (status: QueryRunStatus[]) => void;
  updateRunStatus: (queryId: string, patch: Partial<QueryRunStatus>) => void;
  clearRunAllStatus: () => void;
  setRunAllActive: (active: boolean) => void;
}

const MAX_RUN_HISTORY = 100;

export const usePreviewStore = create<PreviewState>((set) => ({
  data: null,
  profiles: [],
  loading: false,
  error: null,
  durationMs: 0,
  activeStepIndex: -1,
  runNonce: 0,
  runHistory: [],
  runAllStatus: [],
  runAllActive: false,

  setData: (data) => set({ data }),
  setProfiles: (p) => set({ profiles: p }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e, loading: false }),
  setDuration: (ms) => set({ durationMs: ms }),
  setActiveStepIndex: (i) => set({ activeStepIndex: i }),
  requestRun: () => set((s) => ({ runNonce: s.runNonce + 1 })),
  pushRun: (entry) =>
    set((s) => ({
      runHistory: [{ ...entry, timestamp: Date.now() }, ...s.runHistory].slice(0, MAX_RUN_HISTORY),
    })),
  reset: () =>
    set({ data: null, profiles: [], loading: false, error: null, durationMs: 0, activeStepIndex: -1 }),
  setRunAllStatus: (status) => set({ runAllStatus: status }),
  updateRunStatus: (queryId, patch) =>
    set((s) => ({
      runAllStatus: s.runAllStatus.map((r) =>
        r.queryId === queryId ? { ...r, ...patch } : r
      ),
    })),
  clearRunAllStatus: () => set({ runAllStatus: [], runAllActive: false }),
  setRunAllActive: (active) => set({ runAllActive: active }),
}));