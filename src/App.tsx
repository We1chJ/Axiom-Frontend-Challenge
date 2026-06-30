import { useState, useMemo, useCallback } from "react";
import { useTokenStream } from "./data/useTokenStream";
import { TokenList } from "./components/TokenList";
import { Sidebar } from "./components/Sidebar";
import { Controls, type SortKey } from "./components/Controls";

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

  const handleSelect = useCallback(setSelectedId, []);

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
            tokens={sorted}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </section>

        <Sidebar token={selectedToken} />
      </div>
    </div>
  );
}
