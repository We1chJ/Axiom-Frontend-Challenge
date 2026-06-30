import { useRef, useState, useEffect, useLayoutEffect } from "react";
import type { Token } from "../types";
import { TokenRow } from "./TokenRow";

interface TokenListProps {
  tokens: Token[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  rankDirection: "up" | "down" | null;
}

const ROW_HEIGHT = 52;
const BUFFER_ROWS = 5;

export function TokenList({
  tokens,
  selectedId,
  onSelect,
  rankDirection,
}: TokenListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Measure synchronously after mount, before paint, so the real row count
  // is known on the first frame instead of falling back to 0 (which would
  // only render the buffer rows until some unrelated re-render happened to
  // pick up the now-attached ref).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setContainerHeight(container.clientHeight);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);

  const renderStart = Math.max(0, visibleStart - BUFFER_ROWS);
  const renderEnd = Math.min(tokens.length, visibleStart + visibleCount + BUFFER_ROWS);

  const topSpacerHeight = renderStart * ROW_HEIGHT;
  const bottomSpacerHeight = (tokens.length - renderEnd) * ROW_HEIGHT;

  return (
    <div className="feed__list" ref={containerRef}>
      {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
      {tokens.slice(renderStart, renderEnd).map((token) => (
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
