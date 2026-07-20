import type { Step } from "./query";

export interface CTE {
  name: string;
  stepId: string;
  sql: string;
  stepType: string;
}

export interface CompiledQuery {
  ctes: CTE[];
  fullSQL: string;
}

export interface ArrowColumn {
  name: string;
  type: string;
}

export interface ArrowResult {
  columns: ArrowColumn[];
  rows: unknown[][];
  rowCount: number;
}

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
  median?: number;
}

export interface PreviewResult {
  data: ArrowResult;
  profiles: ColumnProfile[];
  durationMs: number;
  error?: string;
}

export interface PlanNode {
  name: string;
  description: string;
  children: PlanNode[];
}

export interface Engine {
  compile(steps: Step[]): CompiledQuery;
  previewStep(steps: Step[], stepIndex: number, limit: number): Promise<PreviewResult>;
  runFull(steps: Step[], limit: number): Promise<PreviewResult>;
  explain(sql: string): Promise<PlanNode>;
}