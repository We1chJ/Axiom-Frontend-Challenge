import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTokenStream } from "./data/useTokenStream";
import { TokenList } from "./components/TokenList";
import { Sidebar } from "./components/Sidebar";
import { Controls, type SortKey } from "./components/Controls";
import type { Token } from "./types";

const TOKEN_COUNT = 10_000;
const UPDATE_INTERVAL_MS = 500;
const CHURN = 0.3;

export default function App() {
  const tokens = useTokenStream({
    count: TOKEN_COUNT,
    intervalMs: UPDATE_INTERVAL_MS,
    churn: CHURN,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("marketCapUsd");
  const [paused, setPaused] = useState(false);

  // While paused, freeze the underlying token *data* at whatever it was when
  // pause was toggled on. Search and sort still run live against this frozen
  // snapshot, so they stay fully interactive — only the price/market-cap
  // ticks (and the reordering they'd otherwise cause) stop.
  const pausedTokensRef = useRef<Token[] | null>(null);
  const effectiveTokens = useMemo(() => {
    if (paused) {
      if (pausedTokensRef.current === null) {
        pausedTokensRef.current = tokens;
      }
      return pausedTokensRef.current;
    }
    pausedTokensRef.current = null;
    return tokens;
  }, [paused, tokens]);

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const filtered = useMemo(() => {
    if (!normalizedQuery) return effectiveTokens;
    return effectiveTokens.filter((token) => {
      return (
        token.name.toLowerCase().includes(normalizedQuery) ||
        token.ticker.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [effectiveTokens, normalizedQuery]);

  const sorted = useMemo(() => {
    return filtered.slice().sort((a, b) => b[sortKey] - a[sortKey]);
  }, [filtered, sortKey]);

  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === selectedId) ?? null,
    [tokens, selectedId]
  );

  // Tracks the row index the selected token was at when it was selected, so
  // we can pin it there while live re-sorting would otherwise move it.
  const lockedIndexRef = useRef<number | null>(null);
  const sortedRef = useRef<Token[]>(sorted);
  useEffect(() => {
    sortedRef.current = sorted;
  }, [sorted]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => {
      if (prev !== id) {
        const idx = sortedRef.current.findIndex((token) => token.id === id);
        lockedIndexRef.current = idx === -1 ? null : idx;
      }
      return id;
    });
  }, []);

  // Reinsert the selected token at its locked index so it stays put while
  // highlighted; everything else keeps reordering live around it.
  const displayTokens = useMemo(() => {
    if (selectedId === null || lockedIndexRef.current === null) return sorted;

    const selectedIndex = sorted.findIndex((token) => token.id === selectedId);
    if (selectedIndex === -1) return sorted;

    const token = sorted[selectedIndex];
    const rest = sorted.filter((t) => t.id !== selectedId);
    const insertAt = Math.min(lockedIndexRef.current, rest.length);
    const result = rest.slice();
    result.splice(insertAt, 0, token);
    return result;
  }, [sorted, selectedId]);

  // Tracks whether the selected token's *natural* (unlocked) rank improved or
  // worsened on the latest tick, so we can show an up/down indicator even
  // though the row itself stays visually fixed in place.
  const [rankDirection, setRankDirection] = useState<"up" | "down" | null>(null);
  const prevNaturalIndexRef = useRef<number | null>(null);
  const trackedSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (paused) return; // freeze whatever direction was last shown

    if (selectedId === null) {
      trackedSelectedIdRef.current = null;
      prevNaturalIndexRef.current = null;
      setRankDirection(null);
      return;
    }

    const naturalIndex = sorted.findIndex((token) => token.id === selectedId);
    if (naturalIndex === -1) {
      prevNaturalIndexRef.current = null;
      setRankDirection(null);
      return;
    }

    if (trackedSelectedIdRef.current !== selectedId) {
      trackedSelectedIdRef.current = selectedId;
      prevNaturalIndexRef.current = naturalIndex;
      setRankDirection(null);
      return;
    }

    if (prevNaturalIndexRef.current !== null && naturalIndex !== prevNaturalIndexRef.current) {
      setRankDirection(naturalIndex < prevNaturalIndexRef.current ? "up" : "down");
    }
    prevNaturalIndexRef.current = naturalIndex;
  }, [sorted, selectedId, paused]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">AXIOM</span>
        <span className="app__subtitle">Token Feed</span>
      </header>

      <div className="app__body">
        <section className="feed">
          <Controls
            query={query}
            onQueryChange={setQuery}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            visibleCount={sorted.length}
            totalCount={tokens.length}
            paused={paused}
            onTogglePause={handleTogglePause}
          />
          <div className="feed__head">
            <div>Token</div>
            <div className="num">Price</div>
            <div className="num col--hide-mobile">Market Cap</div>
            <div className="num col--hide-mobile">Volume</div>
            <div className="num col--hide-mobile">Liquidity</div>
            <div className="num">24h</div>
          </div>
          <TokenList
            tokens={displayTokens}
            selectedId={selectedId}
            onSelect={handleSelect}
            rankDirection={rankDirection}
          />
        </section>

        <Sidebar token={selectedToken} />
      </div>
    </div>
  );
}
