import type { Step } from "./step";

export interface Query {
  id: string;
  name: string;
  folderId: string | null;
  enabled: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  steps: Step[];
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

// Re-export the unified Step model so existing
// `import type { Step } from "../types/query"` imports keep working.
export type { Step, StepKind, StepCategory, StepStatus } from "./step";