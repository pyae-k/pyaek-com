// "Combine" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (append_tables, join_tables) into
// typed StepDefs. buildSql emits SQL that references the previous step via the
// literal token `prev` (resolved to the prior CTE name by engine/cteBuilder).

import type { StepDef } from "./types";
import {
  generateAppendTablesSql,
  generateJoinTablesSql,
  type AppendConfig,
  type JoinConfig,
} from "./helpers";

// --- step definitions -------------------------------------------------------

export const combineSteps: StepDef[] = [
  {
    kind: "append_tables",
    category: "combine",
    name: "Append tables",
    description: "Add rows from other files or tables",
    defaultConfig: { sources: [] },
    buildSql(config) {
      const cfg = config as AppendConfig;
      // helpers already prepend `prev` as the first UNION ALL BY NAME branch.
      return generateAppendTablesSql(cfg, "prev", { preview: false });
    },
  },

  {
    kind: "join_tables",
    category: "combine",
    name: "Join tables",
    description: "Join with another table",
    defaultConfig: {
      joinType: "LEFT",
      schema: "main",
      table: "",
      keys: [{ left: "", right: "" }],
    },
    buildSql(config) {
      const raw = config as Record<string, unknown>;
      // Accept both canonical (joinType/table) and legacy/UI aliases
      // (joinKind/rightTable) so older project shapes keep working.
      const cfg: JoinConfig = {
        ...raw,
        joinType: (raw.joinType as string) || (raw.joinKind as string),
        table: (raw.table as string) || (raw.rightTable as string),
      };
      return generateJoinTablesSql(cfg, "prev");
    },
  },
];