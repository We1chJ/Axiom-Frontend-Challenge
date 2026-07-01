import type { Token } from "../types";

/** Sort keys the feed can order by. Lives here (not in Controls) so both the
 * worker and the UI can share the exact same union without a circular import. */
export type SortKey =
  | "marketCapUsd"
  | "volume24hUsd"
  | "priceChangePct"
  | "ageSeconds";

/** Messages the main thread sends to the worker. */
export type MainToWorker =
  | { type: "init"; count: number; intervalMs: number; churn: number }
  | { type: "query"; query: string }
  | { type: "sort"; sortKey: SortKey }
  | { type: "paused"; paused: boolean }
  | { type: "select"; id: string | null }
  | { type: "viewport"; start: number; end: number };

/** The single message shape the worker pushes back. It carries only the small
 * slice of state the main thread actually needs to paint a frame: the visible
 * window of rows, the counts, and the selected token. The full 1M-row dataset
 * never crosses the thread boundary. */
export interface FeedUpdate {
  type: "update";
  /** Total tokens in the dataset (for the header count). */
  total: number;
  /** How many rows survive the current filter (list height + visible count). */
  visibleCount: number;
  /** Index, within the filtered/sorted list, of the first row in `rows`. */
  windowStart: number;
  /** The materialized rows for the currently requested viewport. */
  rows: Token[];
  /** Up/down rank movement of the selected token, or null. */
  rankDirection: "up" | "down" | null;
  /** Live data for the selected token (independent of the filter), or null. */
  selectedToken: Token | null;
  /** True once the dataset has been generated and the feed is live. */
  ready: boolean;
}
