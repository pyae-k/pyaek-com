import { describe, it, expect } from "vitest";
import { deserialize, fileToState, serialize, createEmptyFile } from "./dataSerializer";
import type { ETLStudioFile } from "../types/etlstudio";

describe("dataSerializer migration", () => {
  it("migrates legacy step `type: sql` -> stepKind custom_sql", () => {
    const legacy = {
      version: "1.0",
      settings: {},
      uiLayout: {},
      folders: [],
      queries: [
        {
          id: "q1",
          name: "Q",
          enabled: true,
          folderId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          steps: [
            { id: "s1", name: "S1", type: "sql", enabled: true, order: 0, sql: "SELECT 1" },
          ],
        },
      ],
      history: [],
      session: {},
    };
    const data = deserialize(legacy) as ETLStudioFile;
    const state = fileToState(data);
    expect(state.queries[0].steps[0].stepKind).toBe("custom_sql");
    expect(state.queries[0].steps[0].config).toEqual({});
    expect(state.queries[0].steps[0].sql).toBe("SELECT 1");
  });

  it("migrates legacy step `type: source` -> stepKind source_file", () => {
    const legacy = {
      version: "1.0",
      queries: [
        {
          id: "q1", name: "Q", enabled: true, folderId: null, order: 0, createdAt: 1, updatedAt: 1,
          steps: [{ id: "s1", name: "S1", type: "source", enabled: true, order: 0, sql: "SELECT * FROM read_csv_auto('x.csv')" }],
        },
      ],
    };
    const data = deserialize(legacy) as ETLStudioFile;
    const state = fileToState(data);
    expect(state.queries[0].steps[0].stepKind).toBe("source_file");
  });

  it("round-trips unified stepKind + config", () => {
    const file = createEmptyFile();
    file.queries = [
      {
        id: "q1", name: "Q", enabled: true, folderId: null, order: 0, createdAt: 1, updatedAt: 1,
        steps: [
          {
            id: "s1", name: "Filter", stepKind: "filter_rows", config: { rules: [{ col: "a", op: "equals", value: "1" }] },
            description: "keep a=1", enabled: true, order: 0, sql: "SELECT * FROM prev WHERE a = '1'",
          },
        ],
      },
    ];
    const state = fileToState(file);
    expect(state.queries[0].steps[0].stepKind).toBe("filter_rows");
    expect((state.queries[0].steps[0].config as { rules: unknown[] }).rules).toHaveLength(1);

    const reserialized = serialize(state.queries, [], {
      activeQueryId: "q1", activeStepId: "s1", bottomTab: "step", mobilePanel: "preview",
      panelSizes: { leftWidth: 260, rightWidth: 300, bottomHeight: 280 },
      leftCollapsed: false, rightCollapsed: false, selectedQueryIds: [], folderExpansion: {},
    }, { theme: "dark", language: "en", previewLimit: 1000, autoRun: true, autoSave: true }, []);
    expect(reserialized.version).toBe("2.0");
    expect(reserialized.queries[0].steps[0].stepKind).toBe("filter_rows");
  });
});