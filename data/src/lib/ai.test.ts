import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  stripCodeFences,
  systemPrompt,
  normalizeBaseUrl,
  detectHardwareProfile,
  suggestOllamaModel,
  resolveLatestFamilyTag,
  suggestionLabel,
  OLLAMA_MODEL_CATALOG,
} from "./ai";

describe("ai pure helpers", () => {
  it("stripCodeFences removes a ```sql fence", () => {
    expect(stripCodeFences("```sql\nSELECT 1\n```")).toBe("SELECT 1");
  });
  it("stripCodeFences removes a bare fence", () => {
    expect(stripCodeFences("```\nSELECT * FROM prev\n```")).toBe("SELECT * FROM prev");
  });
  it("stripCodeFences passes through non-fenced text", () => {
    expect(stripCodeFences("SELECT 1")).toBe("SELECT 1");
  });

  it("systemPrompt(sql) references prev and columns", () => {
    const p = systemPrompt("sql", ["a", "b"], "prev");
    expect(p).toContain("`prev`");
    expect(p).toContain('"a", "b"');
    expect(p).toContain("DuckDB SELECT query");
  });
  it("systemPrompt(expr) requests a single scalar expression", () => {
    const p = systemPrompt("expr", [], "prev");
    expect(p).toContain("ONE DuckDB scalar expression");
    expect(p).toContain("columns unknown");
  });

  it("normalizeBaseUrl trims and strips trailing slashes", () => {
    expect(normalizeBaseUrl("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(normalizeBaseUrl("  https://x/  ")).toBe("https://x");
    expect(normalizeBaseUrl("")).toBe("");
  });
});

describe("hardware profile detection", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      hardwareConcurrency: 8,
      deviceMemory: 16,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects high tier with plenty of RAM and cores", () => {
    const p = detectHardwareProfile();
    expect(p.cores).toBe(8);
    expect(p.ramGB).toBe(16);
    expect(p.tier).toBe("high");
  });

  it("detects low tier with few cores and no deviceMemory", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      hardwareConcurrency: 2,
      deviceMemory: undefined,
    });
    const p = detectHardwareProfile();
    expect(p.cores).toBe(2);
    expect(p.ramGB).toBeNull();
    expect(p.tier).toBe("low");
  });
});

describe("Ollama model suggestions", () => {
  const models = [
    "gemma2:2b",
    "gemma2:4b",
    "gemma2:7b",
    "gemma3:2b",
    "gemma3:4b",
    "gemma3:7b",
    "gemma3:9b",
    "gemma3:27b",
    "llama3:latest",
  ];

  it("resolves latest family tag preferring latest", () => {
    expect(resolveLatestFamilyTag(models, "gemma")).toBe("gemma3:27b");
  });

  it("resolves latest family tag when latest exists", () => {
    expect(resolveLatestFamilyTag(["gemma3:4b", "gemma3:latest"], "gemma")).toBe("gemma3:latest");
  });

  it("suggests a small model for low-tier hardware", () => {
    const profile = { cores: 2, ramGB: 4, tier: "low" as const };
    const tag = suggestOllamaModel(models, "gemma", profile, "auto");
    expect(tag).toBe("gemma3:2b");
  });

  it("suggests a balanced model for medium-tier hardware", () => {
    const profile = { cores: 4, ramGB: 12, tier: "medium" as const };
    const tag = suggestOllamaModel(models, "gemma", profile, "auto");
    expect(tag).toBe("gemma3:7b");
  });

  it("suggests the largest fitting model for high-tier hardware", () => {
    const profile = { cores: 16, ramGB: 32, tier: "high" as const };
    const tag = suggestOllamaModel(models, "gemma", profile, "auto");
    expect(tag).toBe("gemma3:27b");
  });

  it("honours explicit size preference", () => {
    const profile = { cores: 16, ramGB: 32, tier: "high" as const };
    expect(suggestOllamaModel(models, "gemma", profile, "tiny")).toBe("gemma3:2b");
    expect(suggestOllamaModel(models, "gemma", profile, "large")).toBe("gemma3:27b");
  });

  it("returns catalog label that fits system", () => {
    const entry = OLLAMA_MODEL_CATALOG.gemma.find((e) => e.tagSuffix === "7b")!;
    expect(suggestionLabel(entry, { cores: 8, ramGB: 16, tier: "high" })).toContain("recommended");
  });

  it("returns requirement label when model needs more RAM", () => {
    const entry = OLLAMA_MODEL_CATALOG.gemma.find((e) => e.tagSuffix === "27b")!;
    expect(suggestionLabel(entry, { cores: 4, ramGB: 8, tier: "medium" })).toContain("Requires");
  });
});