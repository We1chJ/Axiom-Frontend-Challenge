import { useRef, useState, useEffect, useLayoutEffect } from "react";
import type { Token } from "../types";
import { TokenRow } from "./TokenRow";

interface TokenListProps {
  /** Total rows in the (filtered) list — drives the scrollable height. */
  total: number;
  /** Index of the first row in `rows` within the full list. */
  windowStart: number;
  /** The materialized rows for the current viewport (from the worker). */
  rows: Token[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  rankDirection: "up" | "down" | null;
  /** Report the row range the viewport wants so the worker can supply it. */
  onRangeChange: (start: number, end: number) => void;
}

const ROW_HEIGHT = 52;
// Generous buffer hides the one-frame latency of the worker round-trip when
// scrolling fast, so freshly exposed rows are almost always already present.
const BUFFER_ROWS = 20;

export function TokenList({
  total,
  windowStart,
  rows,
  selectedId,
  onSelect,
  rankDirection,
  onRangeChange,
}: TokenListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setContainerHeight(container.clientHeight);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => setScrollTop(container.scrollTop);
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
  const renderStart = Math.max(0, visibleStart - BUFFER_ROWS);
  const renderEnd = Math.min(total, visibleStart + visibleCount + BUFFER_ROWS);

  // Ask the worker for the range this viewport needs.
  useEffect(() => {
    onRangeChange(renderStart, renderEnd);
  }, [renderStart, renderEnd, onRangeChange]);

  // Spacers are derived from the delivered window (not the desired range) so
  // the rendered rows always sit at the correct scroll offset.
  const topSpacerHeight = windowStart * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(
    0,
    (total - (windowStart + rows.length)) * ROW_HEIGHT
  );

  return (
    <div className="feed__list" ref={containerRef}>
      {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
      {rows.map((token) => (
        <TokenRow
          key={token.id}
          token={token}
          selected={token.id === selectedId}
          onSelect={onSelect}
          rankDirection={token.id === selectedId ? rankDirection : null}
        />
      ))}
      {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
    </div>
  );
}
