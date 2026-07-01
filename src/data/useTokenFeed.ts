import { useCallback, useEffect, useRef, useState } from "react";
import type { Token } from "../types";
import type { FeedUpdate, MainToWorker, SortKey } from "./feedProtocol";

interface FeedView {
  total: number;
  visibleCount: number;
  windowStart: number;
  rows: Token[];
  rankDirection: "up" | "down" | null;
  selectedToken: Token | null;
  ready: boolean;
}

const INITIAL_VIEW: FeedView = {
  total: 0,
  visibleCount: 0,
  windowStart: 0,
  rows: [],
  rankDirection: null,
  selectedToken: null,
  ready: false,
};

/**
 * Owns the data worker. All the heavy lifting (generation, mutation, filter,
 * sort, selection pinning) lives off the main thread; this hook just forwards
 * user intent to the worker and exposes the small view it pushes back.
 */
export function useTokenFeed(count: number, intervalMs: number, churn: number) {
  const workerRef = useRef<Worker | null>(null);
  const [view, setView] = useState<FeedView>(INITIAL_VIEW);

  // UI control state stays on the main thread (these drive the inputs); each
  // change is mirrored to the worker.
  const [query, setQueryState] = useState("");
  const [sortKey, setSortKeyState] = useState<SortKey>("marketCapUsd");
  const [paused, setPausedState] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const post = useCallback((m: MainToWorker) => {
    workerRef.current?.postMessage(m);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("./tokenWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<FeedUpdate>) => {
      const d = e.data;
      if (d.type === "update") {
        setView({
          total: d.total,
          visibleCount: d.visibleCount,
          windowStart: d.windowStart,
          rows: d.rows,
          rankDirection: d.rankDirection,
          selectedToken: d.selectedToken,
          ready: d.ready,
        });
      }
    };
    worker.postMessage({ type: "init", count, intervalMs, churn });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [count, intervalMs, churn]);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      post({ type: "query", query: q.trim().toLowerCase() });
    },
    [post]
  );

  const setSortKey = useCallback(
    (k: SortKey) => {
      setSortKeyState(k);
      post({ type: "sort", sortKey: k });
    },
    [post]
  );

  const togglePause = useCallback(() => {
    setPausedState((p) => {
      const next = !p;
      post({ type: "paused", paused: next });
      return next;
    });
  }, [post]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      post({ type: "select", id });
    },
    [post]
  );

  // Dedupe viewport posts so scrolling within the same range is a no-op.
  const rangeRef = useRef({ start: -1, end: -1 });
  const setRange = useCallback(
    (start: number, end: number) => {
      if (rangeRef.current.start === start && rangeRef.current.end === end) {
        return;
      }
      rangeRef.current = { start, end };
      post({ type: "viewport", start, end });
    },
    [post]
  );

  return {
    ...view,
    query,
    setQuery,
    sortKey,
    setSortKey,
    paused,
    togglePause,
    selectedId,
    select,
    setRange,
  };
}
