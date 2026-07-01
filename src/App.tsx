import { useTokenFeed } from "./data/useTokenFeed";
import { TokenList } from "./components/TokenList";
import { Sidebar } from "./components/Sidebar";
import { Controls } from "./components/Controls";

const TOKEN_COUNT = 1_000_000;
const UPDATE_INTERVAL_MS = 500;
const CHURN = 0.3;

export default function App() {
  const feed = useTokenFeed(TOKEN_COUNT, UPDATE_INTERVAL_MS, CHURN);

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">AXIOM</span>
        <span className="app__subtitle">Token Feed</span>
      </header>

      <div className="app__body">
        <section className="feed">
          <Controls
            query={feed.query}
            onQueryChange={feed.setQuery}
            sortKey={feed.sortKey}
            onSortKeyChange={feed.setSortKey}
            visibleCount={feed.visibleCount}
            totalCount={feed.total}
            paused={feed.paused}
            onTogglePause={feed.togglePause}
          />
          <div className="feed__head">
            <div>Token</div>
            <div className="num">Price</div>
            <div className="num col--hide-mobile">Market Cap</div>
            <div className="num col--hide-mobile">Volume</div>
            <div className="num col--hide-mobile">Liquidity</div>
            <div className="num">24h</div>
          </div>
          {feed.ready ? (
            <TokenList
              total={feed.visibleCount}
              windowStart={feed.windowStart}
              rows={feed.rows}
              selectedId={feed.selectedId}
              onSelect={feed.select}
              rankDirection={feed.rankDirection}
              onRangeChange={feed.setRange}
            />
          ) : (
            <div className="feed__loading">
              Generating {TOKEN_COUNT.toLocaleString("en-US")} tokens…
            </div>
          )}
        </section>

        <Sidebar token={feed.selectedToken} />
      </div>
    </div>
  );
}
