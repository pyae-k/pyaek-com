import { create } from "zustand";
import { useQueryStore } from "./queryStore";
import type { Step } from "../types/query";

interface StepState {
  steps: Step[];
  activeQueryId: string | null;
  loadSteps: (queryId: string) => void;
  refresh: () => void;
}

let currentQueryId: string | null = null;

export const useStepStore = create<StepState>((set) => ({
  steps: [],
  activeQueryId: null,

  loadSteps: (queryId) => {
    currentQueryId = queryId;
    const steps = queryId ? useQueryStore.getState().getSteps(queryId) : [];
    set({ steps, activeQueryId: queryId });
  },

  refresh: () => {
    if (currentQueryId) {
      const steps = useQueryStore.getState().getSteps(currentQueryId);
      set({ steps });
    }
  },
}));