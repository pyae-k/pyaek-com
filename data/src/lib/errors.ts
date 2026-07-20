// Typed error classes for the DuckDB engine (ported from pwa_duckdb/js/duckdb-engine.js).

import type { Step } from "../types/query";

export class SourceRelinkRequiredError extends Error {
  readonly step?: Step;
  constructor(step?: Step, message?: string) {
    super(
      message ??
        `Source file "${step?.config?.sourceName ?? "file"}" is not loaded — re-link the file to preview.`,
    );
    this.name = "SourceRelinkRequiredError";
    this.step = step;
  }
}

export class SessionTableMissingError extends Error {
  readonly tableName: string;
  constructor(tableName: string, message?: string) {
    super(message ?? `Saved table "${tableName}" is not in memory — re-run the pipeline from source or re-import.`);
    this.name = "SessionTableMissingError";
    this.tableName = tableName;
  }
}

export function isSourceRelinkRequired(e: unknown): e is SourceRelinkRequiredError {
  return e instanceof SourceRelinkRequiredError;
}

export function isSessionTableMissing(e: unknown): e is SessionTableMissingError {
  return e instanceof SessionTableMissingError;
}