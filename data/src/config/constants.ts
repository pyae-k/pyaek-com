// Legacy step-type label lookup kept for any remaining references. The
// authoritative step catalog lives in src/steps/* (per-category StepDef
// objects with buildSql + optional Dialog).
export const STEP_CATALOG: Record<string, { label: string; icon: string }> = {
  custom_sql: { label: "SQL Step", icon: "🔧" },
  source_file: { label: "Source", icon: "📥" },
};

export const PREVIEW_LIMITS = [100, 500, 1000, 5000, 10000] as const;