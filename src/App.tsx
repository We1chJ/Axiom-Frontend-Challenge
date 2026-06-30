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

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const filtered = useMemo(() => {
    if (!normalizedQuery) return tokens;
    return tokens.filter((token) => {
      return (
        token.name.toLowerCase().includes(normalizedQuery) ||
        token.ticker.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [tokens, normalizedQuery]);

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
          />
        </section>

        <Sidebar token={selectedToken} />
      </div>
    </div>
  );
}
