/**
 * Staging model for imports.
 *
 * Every source format is normalized into these shapes before anything touches
 * the domain. Adapters produce staged rows; the commit step turns staged rows
 * into expenses and settlements. Nothing about a source's file layout leaks
 * past this boundary — not Splitwise's, and not Balancia's own export.
 */

import type { EntryDirection } from "@/modules/expenses/direction";

export type ImportSourceFormat =
  "splitwise_csv" | "splitwise_json" | "balancia_json";

export interface StagedParticipant {
  /** Name exactly as it appeared in the source. */
  readonly sourceName: string;
  readonly email?: string | null;
}

export interface StagedShare {
  readonly sourceName: string;
  /** Minor units, as a decimal string. Positive = owes this much. */
  readonly amount: string;
}

export interface StagedExpense {
  readonly kind: "expense";
  /**
   * Which way the money went. Only a Balancia backup carries one; absent means
   * `out`, which is what every other source records and what an entry written
   * before income existed was.
   */
  readonly direction?: EntryDirection;
  readonly description: string;
  readonly category?: string | null;
  /**
   * Only a Balancia backup carries one — no other source has a second level.
   * Kept only when it belongs to the category the row resolves to.
   */
  readonly subcategory?: string | null;
  readonly notes?: string | null;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Total in minor units, as a decimal string. */
  readonly amount: string;
  readonly currency: string;
  /** Who paid, and how much. Several payers are supported. */
  readonly payers: readonly StagedShare[];
  /** Who owes what. Must sum to `amount`. */
  readonly shares: readonly StagedShare[];
}

export interface StagedSettlement {
  readonly kind: "settlement";
  readonly date: string;
  readonly amount: string;
  readonly currency: string;
  readonly fromSourceName: string;
  readonly toSourceName: string;
  readonly notes?: string | null;
}

export type StagedRow = StagedExpense | StagedSettlement;

export interface ImportWarning {
  readonly rowNumber: number | null;
  readonly message: string;
  /** Non-blocking detail, e.g. the raw line that could not be parsed. */
  readonly detail?: string;
}

export interface ParsedImport {
  readonly format: ImportSourceFormat;
  readonly rows: readonly { rowNumber: number; row: StagedRow }[];
  readonly participants: readonly StagedParticipant[];
  readonly currencies: readonly string[];
  readonly warnings: readonly ImportWarning[];
  /** Headers or structural facts worth showing in the preview. */
  readonly detected: Record<string, unknown>;
}

export class ImportParseError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ImportParseError";
  }
}

export interface ImportAdapter {
  readonly format: ImportSourceFormat;
  /** Cheap check used to pick an adapter for an uploaded file. */
  detect(content: string, fileName: string): boolean;
  parse(content: string): ParsedImport;
}
