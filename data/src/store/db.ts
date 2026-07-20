import Dexie, { type Table } from "dexie";

export interface KVRow {
  key: string;
  value: unknown;
}

export class ETLDexie extends Dexie {
  kv!: Table<KVRow, string>;

  constructor() {
    super("pwa_etl_studio");
    this.version(4).stores({
      kv: "key",
    });
  }
}

export const db = new ETLDexie();